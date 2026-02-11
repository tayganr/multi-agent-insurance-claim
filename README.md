# 🤖 Agentic Claims Processor (Proof of Concept)  
  
## 🚀 Project Purpose  
  
This repository is a **proof of concept** for using multi-agent AI systems to automate complex, real-world processes, in this case, insurance claims processing. The goal is to **demonstrate** the orchestration, tool calling, and inter-agent communication possible with OpenAI’s Agent SDK on Azure.  
  
> **Note:** This is **not** intended as a production reference, but as a transparent, extensible sandbox for exploring agentic process automation.  
  
## 🛠️ Getting Started  
  
1. **Clone the repository**    
    ```bash  
    git clone https://github.com/tayganr/multi-agent-insurance-claim  
    cd multi-agent-insurance-claim
    ```  
  
2. **Create and activate a Python virtual environment**    
    ```bash  
    python -m venv .venv  
    # On Windows:  
    .venv\Scripts\activate  
    # On Unix/Mac:  
    source .venv/bin/activate  
    ```  
  
3. **Install dependencies**    
    ```bash  
    pip install -r requirements.txt  
    ```  
  
4. **Configure Azure credentials**    
    - Sign in with Azure CLI: `az login`  
    - Ensure your account has the **Cognitive Services OpenAI User** role on your Azure OpenAI resource and the **Cognitive Services User** role on your Document Intelligence resource.  
    - Create a `.env` file with your endpoints (no API keys needed — authentication uses `DefaultAzureCredential`).  
  
    **Example `.env`:**  
    ```env  
    AZURE_OPENAI_API_VERSION=2024-05-01-preview  
    AZURE_OPENAI_ENDPOINT=https://<your-openai-resource>.cognitiveservices.azure.com/  
    AZURE_OPENAI_DEPLOYMENT=gpt-4.1-mini  
  
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-docintelligence-resource>.cognitiveservices.azure.com/  
    ```
  
5. **Run the backend**    
    ```bash  
    python app.py  
    ```  
  
6. **Open the web UI**    
    - Go to [http://localhost:5000](http://localhost:5000) in your browser.  
    - Select a scenario and run. Watch the agentic process in the timeline/details panels.  
  
## 🏗️ Backend Technical Architecture  
  
### 🧩 Key Technologies  
  
- **[OpenAI Agent SDK](https://openai.github.io/openai-agents-python/)**    
  Enables the definition of agents (LLM-powered) with tools, and orchestrates their execution and communication.  
- **[Azure OpenAI Service](https://azure.microsoft.com/en-au/products/ai-foundry/models/openai/)**    
  Provides GPT models via Azure endpoints.  
- **[Azure Document Intelligence](https://azure.microsoft.com/en-us/products/ai-foundry/tools/document-intelligence)**    
  Extracts text from PDFs/images to markdown as a tool callable by agents.  
- **Flask**    
  Web API backend, serves SSE event streams for real-time UI updates.  
- **Python async/await**    
  All agent tools are async functions for concurrency and streaming.  
  
### 🤝 Agentic Orchestration  
  
- **Parent agent:** `ClaimsManager`  
    - Receives a user request (`Process the insurance claim for policy number X`)  
    - **Strictly enforces a sequential chain** of sub-agent calls (extract documents → verify identity → assess coverage → assess medical → final decision)  
    - Each sub-agent is called as a tool, and receives only the `policy_number`.  
  
- **Sub-agents:** Each has its own markdown instructions and toolset.    
  - 📄 **DocumentExtractor**: Extracts all documents to markdown via Azure Document Intelligence.  
  - 🆔 **IDVerification**: Reads extracted files, compares IDs, and writes verification result.  
  - 📑 **PolicyCoverage**: Reads policy document and assesses coverage.  
  - 🩺 **MedicalAssessor**: Reviews medical documents for validity.  
  - ✅ **ClaimsDecision**: Aggregates all assessments and renders a recommendation.  
  
#### 🛠️ Tool Implementation  
  
- Each tool is an `async def` Python function, decorated with `@function_tool`.  
- Tools can access the filesystem, call Azure APIs, and write outputs.  
- **All tool calls and outputs are streamed to the UI** for transparency.  
  
### ⚙️ Azure/OpenAI Configuration  
  
- LLM requests are made via the Azure OpenAI SDK.  
- Document extraction uses Azure Document Intelligence’s `prebuilt-layout` model.  

## 🔄 Data Flow / Pipeline  
  
1. 🖱️ **User selects a scenario (policy number) and runs the workflow.**  
2. 🧑‍💼 **ClaimsManager** agent receives the "process claim" request.  
3. 🧩 Each sub-agent is called in turn, with the current state (mainly the `policy_number`).  
4. 🛠️ **Tools** are invoked as needed (e.g., to extract documents, read files, write outputs).  
5. 📡 **Agent decisions, tool calls, and outputs** are streamed to the UI for each step.  
6. 🗂️ The UI timeline visualizes the agent workflow, tool invocations, arguments, and results.
  
## 🏭 Agentic Topologies: Pro Code vs. Low Code  
  
While this demo was built using "pro code" (Python, custom backend/frontend) to provide a highly tailored UI for educational purposes, the **parent-agent + sub-agent-as-tool topology** is not limited to code-first environments. Modern low-code platforms, such as **Copilot Studio**, enable you to compose similar agentic workflows, allowing a parent agent (or orchestration workflow) to call sub-agents as actions or tools.  
  
This code-first approach was chosen here to maximize transparency and to let the custom UI surface the reasoning, agent transitions, tool calls, and outputs in a way that helps users deeply understand each step of the agentic process.  
  
> **ℹ️ Production Note:**    
> While the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) was used for rapid prototyping and experimentation, for production scenarios in the Microsoft ecosystem, we recommend evaluating the [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/agent-framework-overview), which is designed for robust, enterprise-scale agentic automation.  
  
## 🤔 Why Multi-Agent?  
  
This demo shows how **specialized agents** with access to different tools and instructions can be **chained together** to automate a complex, multi-step process. Each agent is:  
- 🔍 Auditable (you can see its inputs, outputs, and tools)  
- 🧱 Modular (can swap instructions/tools/logic)  
- ⚙️ Composable (parent agent orchestrates the process)  
  
**The result:** complex business workflows can be broken down into manageable, inspectable, and extensible AI-driven steps.