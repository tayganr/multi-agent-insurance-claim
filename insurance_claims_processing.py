import os
import asyncio
import json
import inspect
from pathlib import Path
from textwrap import indent
from typing import Any
from contextvars import ContextVar

from openai import AsyncAzureOpenAI, OpenAIError
from dotenv import load_dotenv
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import DocumentContentFormat
from azure.core.credentials import AzureKeyCredential

from agents import (
    Agent,
    Runner,
    OpenAIChatCompletionsModel,
    set_tracing_disabled,
    ItemHelpers,
    function_tool,
    # enable_verbose_stdout_logging,  # Uncomment if you want very verbose SDK logs
)

# Load environment variables from .env file
load_dotenv()

# We're using Azure; tracing is disabled to avoid API mismatch
set_tracing_disabled(disabled=True)

# Less noise in the console; uncomment if you want all SDK debug logs.
# enable_verbose_stdout_logging()

# ============================================================================
# CONFIGURATION
# ============================================================================

# Hard-coded policy number for demo purposes
DEMO_POLICY_NUMBER = "POL123456"  # Change this to test different scenarios

# Folder structure
SCENARIOS_FOLDER = "scenarios"  # Where sample data (images/PDFs) is stored
OUTPUTS_FOLDER = "outputs"  # Where all processing outputs are stored

# Azure Document Intelligence credentials
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
AZURE_DOCUMENT_INTELLIGENCE_API_KEY = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_API_KEY")

# Initialize the Azure Document Intelligence client
_document_client = DocumentIntelligenceClient(
    endpoint=AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
    credential=AzureKeyCredential(AZURE_DOCUMENT_INTELLIGENCE_API_KEY),
)

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================


def print_heading(text: str):
    """Print a formatted heading."""
    print("\n" + "=" * 80)
    print(text)
    print("=" * 80)


def maybe_truncate(text: str, max_lines: int = 25) -> str:
    """Optionally truncate long outputs for readability."""
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text
    head = "\n".join(lines[:max_lines])
    return head + f"\n\n... (truncated, {len(lines) - max_lines} more lines) ..."


# Context variable to store tool call queue for SSE streaming
tool_call_queue: ContextVar[asyncio.Queue] = ContextVar('tool_call_queue', default=None)


async def print_tool_call(*args):
    """Record tool call for streaming to UI."""
    # Get the calling function's name and code object
    frame = inspect.currentframe()
    caller_frame = frame.f_back
    tool_name = caller_frame.f_code.co_name if caller_frame else "unknown"
    
    print(f"  🔧 Tool called: {tool_name} with args: {args}")
    
    # Also send to queue if available
    queue = tool_call_queue.get(None)
    if queue:
        # Try to get parameter names from the function's code object directly
        args_dict = {}
        try:
            # Get parameter names directly from the code object
            code = caller_frame.f_code
            param_count = code.co_argcount
            param_names = code.co_varnames[:param_count]
            
            # Map args to parameter names
            for i, arg in enumerate(args):
                if i < len(param_names):
                    args_dict[param_names[i]] = arg
                else:
                    args_dict[f'arg{i}'] = arg
                    
        except Exception as e:
            # Fallback to positional args
            print(f"  ⚠️ Could not introspect {tool_name}: {e}")
            args_dict = {f'arg{i}': arg for i, arg in enumerate(args)}
        
        await queue.put({
            'type': 'internal_tool_call',
            'tool_name': tool_name,
            'args': str(args),  # Keep for backward compatibility
            'args_dict': args_dict  # Structured args with parameter names
        })


def ensure_output_folder(policy_number: str, subfolder: str) -> str:
    """Ensure output folder exists and return the path."""
    folder_path = os.path.join(OUTPUTS_FOLDER, policy_number, subfolder)
    os.makedirs(folder_path, exist_ok=True)
    return folder_path


def write_output_file(policy_number: str, subfolder: str, filename: str, content: str):
    """Write content to an output file."""
    folder_path = ensure_output_folder(policy_number, subfolder)
    file_path = os.path.join(folder_path, filename)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  💾 Saved output to: {file_path}")


# ============================================================================
# TOOLS FOR DOCUMENT EXTRACTOR AGENT
# ============================================================================


@function_tool
async def get_policy_files(policy_number: str) -> list[str]:
    """
    Returns a list of file paths for all original documents in the scenario folder
    for the given policy number.
    """
    await print_tool_call(policy_number)
    policy_path = os.path.join(SCENARIOS_FOLDER, policy_number)
    
    if not os.path.exists(policy_path):
        return []
    
    file_paths = []
    for root, _, files in os.walk(policy_path):
        for file in files:
            # Only include PDF and image files
            if file.lower().endswith(('.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.bmp')):
                file_paths.append(os.path.join(root, file))
    
    return file_paths


@function_tool
async def extract_document(file_path: str, policy_number: str) -> str:
    """
    Extracts Markdown from a PDF or image using Azure Document Intelligence.
    Saves to 'outputs/<policy_number>/documents_extracted/<filename>.md'.
    Returns the extracted markdown content.
    """
    await print_tool_call(file_path, policy_number)
    
    # Read the file as bytes
    with open(file_path, "rb") as f:
        data = f.read()
    
    # Call Azure Document Intelligence
    poller = _document_client.begin_analyze_document(
        model_id="prebuilt-layout",
        body=data,
        output_content_format=DocumentContentFormat.MARKDOWN,
    )
    result = poller.result()
    markdown = result.content
    
    # Build output path
    filename = os.path.basename(file_path)
    filename_no_ext = os.path.splitext(filename)[0]
    
    # Save to outputs folder
    write_output_file(
        policy_number,
        "documents_extracted",
        filename_no_ext + ".md",
        markdown
    )
    
    return f"Successfully extracted {filename} to markdown. Content length: {len(markdown)} characters."


# ============================================================================
# TOOLS FOR ID VERIFICATION AGENT
# ============================================================================


@function_tool
async def read_extracted_file(policy_number: str, filename: str) -> str:
    """
    Reads a markdown file from the documents_extracted folder for the given policy number.
    """
    await print_tool_call(policy_number, filename)
    
    file_path = os.path.join(OUTPUTS_FOLDER, policy_number, "documents_extracted", filename)
    
    encodings = ['utf-8', 'cp1252', 'latin-1']
    last_exception = None
    
    for encoding in encodings:
        try:
            with open(file_path, 'r', encoding=encoding) as file:
                return file.read()
        except Exception as e:
            last_exception = e
    
    # If all encodings fail, raise the last encountered exception
    raise last_exception


@function_tool
async def list_extracted_files(policy_number: str) -> list[str]:
    """
    Returns a list of all extracted markdown files for the given policy number.
    """
    await print_tool_call(policy_number)
    
    extracted_path = os.path.join(OUTPUTS_FOLDER, policy_number, "documents_extracted")
    
    if not os.path.exists(extracted_path):
        return []
    
    files = []
    for filename in os.listdir(extracted_path):
        if filename.endswith('.md'):
            files.append(filename)
    
    return files


@function_tool
async def get_policy_holder_details(policy_number: str) -> dict:
    """
    Returns policy holder details for a given policy number from the mock backend system.
    """
    await print_tool_call(policy_number)
    
    mock_db = {
        "POL123456": {
            "name": "Alice Smith",
            "dob": "1990-01-02",
            "gender": "Female",
            "address": "123 High Street, London",
            "licence_number": "SMITH123456A98BC"
        },
        "POL654321": {
            "name": "Bob Johnson",
            "dob": "1977-11-23",
            "gender": "Male",
            "address": "17 Old Kent Road, London",
            "licence_number": "JOHNS854776BJ4GH"
        },
        "POL111222": {
            "name": "Robert Crook",
            "dob": "1966-04-01",
            "gender": "Male",
            "address": "1 Angel Ct, London",
            "licence_number": "CROOK70601916RJVN"
        }
    }
    
    details = mock_db.get(policy_number)
    if details:
        return {"policy_number": policy_number, **details}
    else:
        return {"error": f"Policy number '{policy_number}' not found. Please check and try again."}


@function_tool
async def save_id_verification_result(policy_number: str, result: str) -> str:
    """
    Saves the ID verification result to the outputs folder.
    """
    await print_tool_call(policy_number, result[:100] + "...")
    
    write_output_file(
        policy_number,
        "id_verification",
        "verification_result.md",
        result
    )
    
    return "ID verification result saved successfully."


# ============================================================================
# TOOLS FOR POLICY COVERAGE AGENT
# ============================================================================


@function_tool
async def read_policy_document(policy_type: str = "standard") -> str:
    """
    Reads the policy coverage document (PDF converted to text/markdown).
    This represents the knowledge base for policy coverage rules.
    """
    await print_tool_call(policy_type)
    
    # In a real scenario, this would read from a vectorized knowledge base
    # For now, we'll return mock policy coverage information
    policy_content = """
# Insurance Policy Coverage Document

## Coverage Types

### Medical Expenses
- Hospitalization: Covered up to £50,000 per incident
- Outpatient treatment: Covered up to £5,000 per year
- Emergency treatment: Fully covered
- Prescription medications: 80% covered after £50 deductible

### Accident Coverage
- Accidental injury: Covered up to £100,000
- Disability: Covered up to £200,000 for permanent disability
- Death benefit: £500,000

### Exclusions
- Pre-existing conditions (unless declared and accepted)
- Self-inflicted injuries
- Injuries resulting from illegal activities
- Cosmetic procedures (unless medically necessary)
- Alternative medicine (unless specifically endorsed)

### Waiting Periods
- General medical: 30 days from policy start
- Pre-existing conditions: 12 months from policy start

### Required Documentation
- Hospital discharge summary
- Itemized invoices/bills
- Medical reports from treating physician
- Valid ID matching policy holder details
- Police report (if accident-related)
"""
    
    return policy_content


@function_tool
async def save_coverage_assessment(policy_number: str, assessment: str) -> str:
    """
    Saves the policy coverage assessment result to the outputs folder.
    """
    await print_tool_call(policy_number, assessment[:100] + "...")
    
    write_output_file(
        policy_number,
        "coverage_assessment",
        "coverage_result.md",
        assessment
    )
    
    return "Coverage assessment saved successfully."


# ============================================================================
# TOOLS FOR MEDICAL ASSESSOR AGENT
# ============================================================================


@function_tool
async def save_medical_assessment(policy_number: str, assessment: str) -> str:
    """
    Saves the medical assessment result to the outputs folder.
    """
    await print_tool_call(policy_number, assessment[:100] + "...")
    
    write_output_file(
        policy_number,
        "medical_assessment",
        "medical_review.md",
        assessment
    )
    
    return "Medical assessment saved successfully."


# ============================================================================
# TOOLS FOR CLAIMS DECISION AGENT
# ============================================================================


@function_tool
async def read_all_assessment_results(policy_number: str) -> dict[str, str]:
    """
    Reads all assessment results from previous agents for the given policy number.
    Returns a dictionary with keys: id_verification, coverage_assessment, medical_assessment.
    """
    await print_tool_call(policy_number)
    
    results = {}
    
    # Read ID verification
    id_path = os.path.join(OUTPUTS_FOLDER, policy_number, "id_verification", "verification_result.md")
    if os.path.exists(id_path):
        with open(id_path, 'r', encoding='utf-8') as f:
            results['id_verification'] = f.read()
    
    # Read coverage assessment
    coverage_path = os.path.join(OUTPUTS_FOLDER, policy_number, "coverage_assessment", "coverage_result.md")
    if os.path.exists(coverage_path):
        with open(coverage_path, 'r', encoding='utf-8') as f:
            results['coverage_assessment'] = f.read()
    
    # Read medical assessment
    medical_path = os.path.join(OUTPUTS_FOLDER, policy_number, "medical_assessment", "medical_review.md")
    if os.path.exists(medical_path):
        with open(medical_path, 'r', encoding='utf-8') as f:
            results['medical_assessment'] = f.read()
    
    return results


@function_tool
async def save_final_decision(policy_number: str, decision: str) -> str:
    """
    Saves the final claims decision to the outputs folder.
    """
    await print_tool_call(policy_number, decision[:100] + "...")
    
    write_output_file(
        policy_number,
        "final_decision",
        "claims_decision.md",
        decision
    )
    
    return "Final claims decision saved successfully."


# ============================================================================
# AGENT DEFINITIONS
# ============================================================================


async def create_agents(model_config: OpenAIChatCompletionsModel):
    """Create all the agents for the insurance claims processing system."""
    
    # Helper function to load instructions from file
    def load_instructions(filename: str) -> str:
        instructions_dir = Path(__file__).parent / "instructions"
        with open(instructions_dir / filename, "r", encoding="utf-8") as f:
            return f.read()
    
    # Sub-agent: Document Extractor
    document_extractor_agent = Agent(
        name="DocumentExtractor",
        instructions=load_instructions("document_extractor.md"),
        model=model_config,
        tools=[get_policy_files, extract_document],
    )
    
    # Sub-agent: ID Verification
    id_verification_agent = Agent(
        name="IDVerification",
        instructions=load_instructions("id_verification.md"),
        model=model_config,
        tools=[list_extracted_files, read_extracted_file, get_policy_holder_details, save_id_verification_result],
    )
    
    # Sub-agent: Policy Coverage
    policy_coverage_agent = Agent(
        name="PolicyCoverage",
        instructions=load_instructions("policy_coverage.md"),
        model=model_config,
        tools=[read_policy_document, list_extracted_files, read_extracted_file, save_coverage_assessment],
    )
    
    # Sub-agent: Medical Assessor
    medical_assessor_agent = Agent(
        name="MedicalAssessor",
        instructions=load_instructions("medical_assessor.md"),
        model=model_config,
        tools=[list_extracted_files, read_extracted_file, save_medical_assessment],
    )
    
    # Sub-agent: Claims Decision
    claims_decision_agent = Agent(
        name="ClaimsDecision",
        instructions=load_instructions("claims_decision.md"),
        model=model_config,
        tools=[read_all_assessment_results, save_final_decision],
    )
    
    # Custom output extractor for agent tools
    # This ensures we only return the final output, not interim messages
    async def extract_final_output(run_result) -> str:
        """Extract only the final output from an agent run, avoiding interim messages."""
        # The final_output already contains the last message content
        # This is cleaner than str(run_result) which includes all intermediate messages
        return str(run_result.final_output)
    
    # Parent Agent: Claims Manager
    claims_manager_agent = Agent(
        name="ClaimsManager",
        instructions=(
            "You are the Claims Manager overseeing the entire insurance claims processing workflow.\n\n"
            "Your job is to coordinate specialized agents to process an insurance claim for a given policy number. "
            "You MUST ALWAYS execute the COMPLETE workflow in this specific order, regardless of intermediate results:\n\n"
            "1. Call extract_documents to have the DocumentExtractor agent extract all claim documents to markdown\n"
            "2. Call verify_identity to have the IDVerification agent verify the policy holder's identity\n"
            "3. Call assess_coverage to have the PolicyCoverage agent determine if the claim is covered\n"
            "4. Call assess_medical to have the MedicalAssessor agent review medical validity\n"
            "5. Call make_decision to have the ClaimsDecision agent make the final recommendation\n\n"
            "CRITICAL: You must ALWAYS complete ALL 5 steps, even if earlier steps reveal issues, concerns, or red flags. "
            "Never stop the workflow early. Each step provides valuable information that contributes to the final decision. "
            "The ClaimsDecision agent will consider all findings holistically to make the final recommendation.\n\n"
            "After all agents complete their work, provide a brief executive summary of the entire process "
            "and final outcome.\n\n"
            "Always pass the policy_number as input to each sub-agent."
        ),
        model=model_config,
        tools=[
            document_extractor_agent.as_tool(
                tool_name="extract_documents",
                tool_description="📄 Extract and convert all claim documents (PDFs/images) to markdown format",
                custom_output_extractor=extract_final_output,
            ),
            id_verification_agent.as_tool(
                tool_name="verify_identity",
                tool_description="🪪 Verify the policy holder's identity against provided ID documents",
                custom_output_extractor=extract_final_output,
            ),
            policy_coverage_agent.as_tool(
                tool_name="assess_coverage",
                tool_description="📋 Assess whether the claim is covered under the policy",
                custom_output_extractor=extract_final_output,
            ),
            medical_assessor_agent.as_tool(
                tool_name="assess_medical",
                tool_description="🏥 Review medical documents and assess medical validity of the claim",
                custom_output_extractor=extract_final_output,
            ),
            claims_decision_agent.as_tool(
                tool_name="make_decision",
                tool_description="⚖️ Make the final claims decision based on all assessments",
                custom_output_extractor=extract_final_output,
            ),
        ],
    )
    
    return claims_manager_agent


# ============================================================================
# MAIN EXECUTION
# ============================================================================


async def main():
    try:
        print_heading("🏥 Insurance Claims Processing System")
        print(f"Processing claim for policy number: {DEMO_POLICY_NUMBER}")
        
        # Azure OpenAI client
        client = AsyncAzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        )
        
        # Shared model configuration
        model_config = OpenAIChatCompletionsModel(
            model=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
            openai_client=client,
        )
        
        # Create all agents
        claims_manager = await create_agents(model_config)
        
        # Prepare the request
        user_request = f"Process the insurance claim for policy number {DEMO_POLICY_NUMBER}. Execute the full workflow."
        
        print_heading("👤 Claims Manager Request")
        print(user_request)
        
        # Streaming run
        streaming_result = Runner.run_streamed(claims_manager, user_request)
        
        # Track tool calls and agent outputs
        tool_call_queue: list[str] = []
        agent_messages: list[tuple[str, str]] = []  # (agent_name, message_text)
        step_counter = 1
        current_agent_name = claims_manager.name
        
        async for event in streaming_result.stream_events():
            if event.type == "raw_response_event":
                # Low-level token events, skip for readability
                continue
            
            if event.type == "agent_updated_stream_event":
                current_agent_name = event.new_agent.name
                print_heading(f"🔄 Active Agent: {current_agent_name}")
                continue
            
            if event.type == "run_item_stream_event":
                item = event.item
                
                # 1) Manager/Agent decides to call a sub-agent or tool
                if item.type == "tool_call_item":
                    raw = getattr(item, "raw_item", None)
                    tool_name = "<unknown_tool>"
                    arguments = None
                    
                    if raw is not None:
                        tool_name = getattr(raw, "name", tool_name)
                        func_obj = getattr(raw, "function", None)
                        if func_obj is not None and hasattr(func_obj, "name"):
                            tool_name = getattr(func_obj, "name", tool_name)
                            arguments = getattr(func_obj, "arguments", None)
                        else:
                            arguments = getattr(raw, "arguments", None)
                    
                    tool_call_queue.append(tool_name)
                    
                    print_heading(f"🔧 Step {step_counter}: Calling tool '{tool_name}'")
                    step_counter += 1
                    
                    # Show tool arguments nicely
                    if arguments:
                        try:
                            parsed_args = json.loads(arguments)
                            pretty = json.dumps(parsed_args, indent=2)
                            print("📥 Tool arguments:\n" + indent(pretty, "  "))
                        except Exception:
                            print("📥 Tool arguments (raw):\n" + indent(arguments, "  "))
                
                # 2) Tool/Sub-agent finishes and returns output
                elif item.type == "tool_call_output_item":
                    if tool_call_queue:
                        tool_name = tool_call_queue.pop(0)
                    else:
                        tool_name = "<unknown_tool>"
                    
                    print_heading(f"✅ Step {step_counter}: Tool '{tool_name}' completed")
                    step_counter += 1
                    
                    output_text = str(item.output)
                    output_text = maybe_truncate(output_text, max_lines=40)
                    print(indent(output_text, "  "))
                
                # 3) Agent sends a normal message
                elif item.type == "message_output_item":
                    text = ItemHelpers.text_message_output(item)
                    print_heading(f"💬 Step {step_counter}: {current_agent_name} responds")
                    step_counter += 1
                    
                    # Store full message for later saving
                    agent_messages.append((current_agent_name, text))
                    
                    text = maybe_truncate(text, max_lines=40)
                    print(indent(text, "  "))
        
        print_heading("🎯 Final Executive Summary")
        final = str(streaming_result.final_output)
        final = maybe_truncate(final, max_lines=60)
        print(final)
        
        # Save the final summary
        write_output_file(
            DEMO_POLICY_NUMBER,
            "agent_summaries",
            "final_summary.md",
            final
        )
        
        # Save individual agent messages
        for agent_name, message_text in agent_messages:
            # Create a sanitized filename
            filename = f"{agent_name.lower().replace(' ', '_')}_output.md"
            write_output_file(
                DEMO_POLICY_NUMBER,
                "agent_summaries",
                filename,
                f"# {agent_name} Output\n\n{message_text}"
            )
        
        print_heading("📁 Output Location")
        print(f"All processing results saved to: {os.path.join(OUTPUTS_FOLDER, DEMO_POLICY_NUMBER)}")
        
    except OpenAIError as e:
        print(f"OpenAI API Error: {str(e)}")
    except Exception as e:
        print(f"An unexpected error occurred: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
