# 🤖 Multi-Agent Insurance Claims Processing System

An AI-powered insurance claims processing system that uses multiple specialized agents to automate the end-to-end claims workflow. Built with OpenAI's multi-agent framework and Azure AI services.

## 📋 Overview

This application demonstrates a real-world multi-agent AI system that processes insurance claims through a structured workflow. A Claims Manager agent orchestrates five specialized sub-agents, each handling a specific aspect of the claims process:

1. **DocumentExtractor** - Extracts content from PDFs and images using Azure Document Intelligence
2. **IDVerification** - Verifies policy holder identity against ID documents
3. **PolicyCoverage** - Assesses whether the claim is covered under the policy
4. **MedicalAssessor** - Reviews medical documents for validity and appropriateness
5. **ClaimsDecision** - Makes final approval/decline recommendations based on all assessments

## ✨ Features

- **Multi-Agent Orchestration**: Hierarchical agent structure with a parent Claims Manager coordinating specialized sub-agents
- **Real-time Streaming UI**: Interactive web interface showing agent workflow and decision-making process
- **Document Intelligence**: Automatic extraction of text from PDFs and images using Azure Document Intelligence
- **Structured Workflow**: Enforced 5-step process ensuring consistent and thorough claim evaluation
- **Rich Output**: Markdown-formatted results with emojis, tables, and clear decision indicators
- **Customizable Theme**: Configure branding and color scheme through settings modal

## 🏗️ Architecture

```
ClaimsManager (Parent Agent)
    ├── DocumentExtractor → Extracts documents to markdown
    ├── IDVerification → Verifies identity
    ├── PolicyCoverage → Assesses coverage
    ├── MedicalAssessor → Reviews medical validity
    └── ClaimsDecision → Makes final recommendation
```

Each agent has:
- **Specialized instructions** loaded from `instructions/*.md` files
- **Custom tools** for their specific domain (file operations, API calls, etc.)
- **Structured output format** using markdown with emojis and tables

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- Azure OpenAI account with GPT-4 deployment
- Azure Document Intelligence service

### Installation

1. Clone the repository:
```bash
git clone https://github.com/tayganr/multi-agent-insurance-claim.git
cd multi-agent-insurance-claim
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file with your Azure credentials:
```env
AZURE_OPENAI_API_KEY=your_api_key_here
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your_gpt4_deployment_name

AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_API_KEY=your_doc_intelligence_key
```

### Running the Application

**Option 1: Web Application (Recommended)**
```bash
python app.py
```
Then open `http://localhost:5000` in your browser.

**Option 2: Command Line**
```bash
python insurance_claims_processing.py
```
Edit `DEMO_POLICY_NUMBER` in the script to test different scenarios.

**Option 3: Windows Batch File**
```bash
run_webapp.bat
```

## 🎯 How It Works

### Workflow

1. **Document Extraction**: The DocumentExtractor agent scans the `scenarios/<policy_number>` folder, extracts text from all PDFs and images using Azure Document Intelligence, and saves markdown files to `outputs/<policy_number>/documents_extracted/`

2. **Identity Verification**: The IDVerification agent reads the extracted driver's license or ID, retrieves official policy holder details from the mock database, compares all fields (name, DOB, license number, address), and saves verification results

3. **Coverage Assessment**: The PolicyCoverage agent reads policy rules, reviews claim documents (invoices, discharge summaries), checks against coverage rules and exclusions, and determines if the claim is covered

4. **Medical Assessment**: The MedicalAssessor agent reviews medical documents, assesses medical necessity and appropriateness of treatment, checks for inconsistencies or red flags, and validates the medical claim

5. **Final Decision**: The ClaimsDecision agent reads all previous assessments, weighs all factors (ID verification, coverage, medical validity), makes final recommendation (approve/decline/more info needed), and provides approval amount or decline reasons

### Web Interface

The Flask web application provides:
- **Real-time streaming** of agent execution using Server-Sent Events (SSE)
- **Visual timeline** showing active agents and tool calls
- **Interactive details panel** displaying agent instructions, tool arguments, and outputs
- **Scenario selector** to test different claim cases
- **Customizable theme** with branding and color options

## 🔧 Configuration

### Adding New Scenarios

1. Create a folder in `scenarios/` with the policy number as the name
2. Add claim documents (PDFs, images): `drivers_license.png`, `hospital_invoice.pdf`, `discharge_summary.pdf`, etc.
3. Add policy holder details to the mock database in `get_policy_holder_details()` function

### Customizing Agents

Each agent's behavior is controlled by:
- **Instructions file** in `instructions/<agent_name>.md` - Defines role, workflow, and output format
- **Tools** assigned in `create_agents()` function - Determines what actions the agent can take

### Modifying the Workflow

The workflow order is enforced in the ClaimsManager agent's instructions. To modify:
1. Edit instructions in `create_agents()` function
2. Add/remove tool assignments
3. Update the workflow steps and ordering logic

## 🛠️ Technologies Used

- **OpenAI Multi-Agent Framework** (`openai-agents`) - Agent orchestration and tool calling
- **Azure OpenAI** - GPT-4 language model
- **Azure Document Intelligence** - PDF and image text extraction
- **Flask** - Web application framework
- **Bootstrap 5** - UI components and styling
- **Marked.js** - Markdown rendering in browser

