import os
import asyncio
import json
import traceback
import inspect
from pathlib import Path
from flask import Flask, render_template, send_from_directory, Response, request, jsonify, stream_with_context
from dotenv import load_dotenv
from openai import AsyncAzureOpenAI

# Import from the existing script
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import insurance_claims_processing
from insurance_claims_processing import create_agents, OpenAIChatCompletionsModel, Runner, ItemHelpers

load_dotenv()

app = Flask(__name__)

# Configuration
SCENARIOS_FOLDER = "scenarios"
OUTPUTS_FOLDER = "outputs"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/scenarios')
def list_scenarios():
    if not os.path.exists(SCENARIOS_FOLDER):
        return jsonify([])
    scenarios = [d for d in os.listdir(SCENARIOS_FOLDER) if os.path.isdir(os.path.join(SCENARIOS_FOLDER, d))]
    return jsonify(scenarios)

@app.route('/files/<path:filename>')
def serve_files(filename):
    if '..' in filename:
        return "Invalid path", 400
    return send_from_directory('.', filename)

@app.route('/api/readme')
def get_readme():
    """Serve the README.md content."""
    try:
        readme_path = os.path.join(os.path.dirname(__file__), 'README.md')
        with open(readme_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return content, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        return f"Error reading README: {str(e)}", 500

# Global cache for agent info to avoid recreating agents
_agent_cache = {}

async def _get_all_agents():
    """Create and cache all agents."""
    if _agent_cache:
        return _agent_cache
    
    client = AsyncAzureOpenAI(
        api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    )
    
    model_config = OpenAIChatCompletionsModel(
        model=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
        openai_client=client,
    )
    
    claims_manager = await create_agents(model_config)
    
    # Get all sub-agents by inspecting the create_agents function
    # Re-create to get individual agent references
    from insurance_claims_processing import (
        Agent, get_policy_files, extract_document,
        read_extracted_file, list_extracted_files, get_policy_holder_details, save_id_verification_result,
        read_policy_document, save_coverage_assessment,
        save_medical_assessment,
        read_all_assessment_results, save_final_decision
    )
    
    # Create sub-agents directly
    document_extractor = Agent(
        name="DocumentExtractor",
        instructions="You are a document extraction specialist...",
        model=model_config,
        tools=[get_policy_files, extract_document],
    )
    
    id_verification = Agent(
        name="IDVerification",
        instructions="You are an identity verification specialist...",
        model=model_config,
        tools=[list_extracted_files, read_extracted_file, get_policy_holder_details, save_id_verification_result],
    )
    
    policy_coverage = Agent(
        name="PolicyCoverage",
        instructions="You are a policy coverage specialist...",
        model=model_config,
        tools=[read_policy_document, list_extracted_files, read_extracted_file, save_coverage_assessment],
    )
    
    medical_assessor = Agent(
        name="MedicalAssessor",
        instructions="You are a medical claims assessor...",
        model=model_config,
        tools=[list_extracted_files, read_extracted_file, save_medical_assessment],
    )
    
    claims_decision = Agent(
        name="ClaimsDecision",
        instructions="You are the final claims decision maker...",
        model=model_config,
        tools=[read_all_assessment_results, save_final_decision],
    )
    
    _agent_cache.update({
        "ClaimsManager": claims_manager,
        "DocumentExtractor": document_extractor,
        "IDVerification": id_verification,
        "PolicyCoverage": policy_coverage,
        "MedicalAssessor": medical_assessor,
        "ClaimsDecision": claims_decision,
    })
    
    return _agent_cache

@app.route('/api/agent-info/<agent_name>')
def get_agent_info(agent_name):
    """Return agent instructions and tools."""
    try:
        # Map agent names to instruction file names
        agent_files = {
            "DocumentExtractor": "document_extractor.md",
            "IDVerification": "id_verification.md",
            "PolicyCoverage": "policy_coverage.md",
            "MedicalAssessor": "medical_assessor.md",
            "ClaimsDecision": "claims_decision.md",
        }
        
        # Map agent names to their tool lists
        agent_tools = {
            "DocumentExtractor": [
                {"name": "get_policy_files", "description": "Retrieve all document file paths for a given policy number"},
                {"name": "extract_document", "description": "Extract content from a document file (PDF or image) and convert to markdown"}
            ],
            "IDVerification": [
                {"name": "list_extracted_files", "description": "List all extracted document files for a policy"},
                {"name": "read_extracted_file", "description": "Read the content of an extracted document file"},
                {"name": "get_policy_holder_details", "description": "Retrieve official policy holder information from the system"},
                {"name": "save_id_verification_result", "description": "Save the ID verification result"}
            ],
            "PolicyCoverage": [
                {"name": "read_policy_document", "description": "Read the policy document to review coverage rules"},
                {"name": "list_extracted_files", "description": "List all extracted document files for a policy"},
                {"name": "read_extracted_file", "description": "Read the content of an extracted document file"},
                {"name": "save_coverage_assessment", "description": "Save the coverage assessment result"}
            ],
            "MedicalAssessor": [
                {"name": "list_extracted_files", "description": "List all extracted document files for a policy"},
                {"name": "read_extracted_file", "description": "Read the content of an extracted document file"},
                {"name": "save_medical_assessment", "description": "Save the medical assessment result"}
            ],
            "ClaimsDecision": [
                {"name": "read_all_assessment_results", "description": "Read all assessment results from previous agents"},
                {"name": "save_final_decision", "description": "Save the final claims decision"}
            ]
        }
        
        if agent_name not in agent_files:
            return jsonify({"error": "Agent not found"}), 404
        
        # Read instructions from markdown file
        instructions_path = Path(__file__).parent / "instructions" / agent_files[agent_name]
        with open(instructions_path, "r", encoding="utf-8") as f:
            instructions = f.read()
        
        return jsonify({
            "name": agent_name,
            "instructions": instructions,
            "tools": agent_tools[agent_name]
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/run/<policy_number>')
def run_agent(policy_number):
    
    def generate():
        async def run_async():
            try:
                # Create a queue for internal tool calls
                from insurance_claims_processing import tool_call_queue
                import asyncio
                queue = asyncio.Queue()
                tool_call_queue.set(queue)
                
                client = AsyncAzureOpenAI(
                    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
                    api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
                    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                )
                
                model_config = OpenAIChatCompletionsModel(
                    model=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
                    openai_client=client,
                )
                
                claims_manager = await create_agents(model_config)
                user_request = f"Process the insurance claim for policy number {policy_number}. Execute the full workflow."
                
                streaming_result = Runner.run_streamed(claims_manager, user_request)
                
                current_agent = None
                tool_call_stack = []
                
                # Helper to check queue without blocking
                async def check_queue():
                    try:
                        while not queue.empty():
                            tool_data = queue.get_nowait()
                            yield f"data: {json.dumps(tool_data)}\n\n"
                    except asyncio.QueueEmpty:
                        pass
                
                async for event in streaming_result.stream_events():
                    # Check for internal tool calls before processing event
                    async for msg in check_queue():
                        yield msg
                    
                    data = None
                    
                    if event.type == "agent_updated_stream_event":
                        current_agent = event.new_agent.name
                        data = {
                            "type": "agent_active",
                            "agent_name": current_agent
                        }
                    
                    elif event.type == "run_item_stream_event":
                        item = event.item
                        
                        if item.type == "tool_call_item":
                            raw = getattr(item, "raw_item", None)
                            tool_name = "<unknown_tool>"
                            arguments = None
                            tool_id = None
                            
                            if raw is not None:
                                tool_name = getattr(raw, "name", tool_name)
                                tool_id = getattr(raw, "id", None)
                                func_obj = getattr(raw, "function", None)
                                if func_obj is not None and hasattr(func_obj, "name"):
                                    tool_name = getattr(func_obj, "name", tool_name)
                                    arguments = getattr(func_obj, "arguments", None)
                                else:
                                    arguments = getattr(raw, "arguments", None)
                            
                            # Track tool calls
                            tool_call_stack.append({
                                "id": tool_id,
                                "name": tool_name,
                                "args": arguments
                            })
                            
                            data = {
                                "type": "tool_call",
                                "tool_name": tool_name,
                                "arguments": arguments,
                                "tool_id": tool_id,
                                "agent_name": current_agent
                            }
                        
                        elif item.type == "tool_call_output_item":
                            # Convert tool output to string
                            # For agent tools, custom_output_extractor in insurance_claims_processing.py
                            # ensures we get only the final output
                            output_text = str(item.output)
                            
                            # Get corresponding tool call
                            matching_tool = None
                            if tool_call_stack:
                                matching_tool = tool_call_stack.pop()
                            
                            data = {
                                "type": "tool_output",
                                "output": output_text,
                                "tool_name": matching_tool["name"] if matching_tool else None,
                                "tool_id": matching_tool["id"] if matching_tool else None,
                                "agent_name": current_agent
                            }
                        
                        elif item.type == "message_output_item":
                            text = ItemHelpers.text_message_output(item)
                            data = {
                                "type": "message",
                                "agent_name": current_agent,
                                "content": text
                            }
                    
                    if data:
                        yield f"data: {json.dumps(data)}\n\n"
                    
                    # Check queue again after processing event
                    async for msg in check_queue():
                        yield msg
                
                # Check queue one final time before finishing
                async for msg in check_queue():
                    yield msg
                
                # Final result
                final = str(streaming_result.final_output)
                yield f"data: {json.dumps({'type': 'final', 'content': final})}\n\n"
                
            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        iter_async = run_async().__aiter__()
        try:
            while True:
                try:
                    chunk = loop.run_until_complete(iter_async.__anext__())
                    yield chunk
                except StopAsyncIteration:
                    break
        except GeneratorExit:
            # Client disconnected, clean up properly
            try:
                loop.run_until_complete(iter_async.aclose())
            except:
                pass
        finally:
            # Cancel any pending tasks
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            # Run loop one more time to allow cancellations to complete
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.close()

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
