const agentInfo = {
    "ClaimsManager": {
        avatar: "claims_manager_agent.png",
        title: "Claims Manager",
        description: "Orchestrates the entire claims processing workflow."
    },
    "DocumentExtractor": {
        avatar: "document_extraction_agent.png",
        title: "Document Extractor",
        description: "Extracts content from PDFs and images into markdown."
    },
    "IDVerification": {
        avatar: "id_verification_agent.png",
        title: "ID Verification",
        description: "Verifies policy holder identity against provided documents."
    },
    "PolicyCoverage": {
        avatar: "policy_coverage_agent.png",
        title: "Policy Coverage",
        description: "Checks if the claim is covered under the policy rules."
    },
    "MedicalAssessor": {
        avatar: "medical_assessment_agent.png",
        title: "Medical Assessor",
        description: "Reviews medical documents for validity and necessity."
    },
    "ClaimsDecision": {
        avatar: "claim_decision_agent.png",
        title: "Claims Decision",
        description: "Makes the final recommendation based on all assessments."
    }
};

const toolToAgentMap = {
    "extract_documents": "DocumentExtractor",
    "verify_identity": "IDVerification",
    "assess_coverage": "PolicyCoverage",
    "assess_medical": "MedicalAssessor",
    "make_decision": "ClaimsDecision"
};

let selectedScenario = null;
let currentEventSource = null;
let currentAgentName = "ClaimsManager";
let currentAgentCardId = null;
let toolCallMap = {}; // Map tool call ID to data
let agentOutputs = {}; // Map agent name to collected outputs
let currentlyViewedAgent = null; // Track which agent is currently shown in details panel
let activeSubAgent = null; // Track which sub-agent is currently executing

document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
    loadTheme();
    
    document.getElementById('run-btn').addEventListener('click', runScenario);
    document.getElementById('clear-feed-btn').addEventListener('click', clearFeed);
    document.getElementById('scenario-select').addEventListener('change', (e) => {
        selectScenario(e.target.value);
    });
});

function loadScenarios() {
    fetch('/api/scenarios')
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('scenario-select');
            select.innerHTML = '<option value="">Select Scenario...</option>';
            
            if (data.length === 0) {
                console.warn('No scenarios found');
                return;
            }
            
            data.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                select.appendChild(option);
            });
        })
        .catch(err => {
            console.error('Error loading scenarios:', err);
        });
}

function selectScenario(scenario) {
    selectedScenario = scenario;
    if (scenario) {
        document.getElementById('run-btn').disabled = false;
    } else {
        document.getElementById('run-btn').disabled = true;
    }
}

function clearFeed() {
    document.getElementById('timeline-container').innerHTML = '<div class="timeline-line" id="timeline-line" style="display: none;"></div>';
    showEmptyDetails();
    toolCallMap = {};
    agentOutputs = {};
    currentAgentName = "ClaimsManager";
    currentAgentCardId = null;
    currentlyViewedAgent = null;
}

function showEmptyDetails() {
    document.getElementById('details-panel').innerHTML = '<div class="text-center text-muted mt-5 p-4"><i class="bi bi-info-circle display-4"></i><p class="mt-3">Select an agent or tool call to view details.</p></div>';
}

function stopScenario() {
    if (currentEventSource) {
        currentEventSource.close();
    }
    
    const btn = document.getElementById('run-btn');
    btn.disabled = false;
    btn.innerHTML = '<img src="/static/icons/play.png" alt="Play" style="width: 20px; height: 20px;">';
    btn.className = 'btn';
    btn.style.backgroundColor = '#e5e7eb';
    btn.style.border = '1px solid #d1d5db';
    btn.onclick = runScenario;
}

function runScenario() {
    if (!selectedScenario) return;
    
    const btn = document.getElementById('run-btn');
    btn.disabled = true;
    btn.innerHTML = '<img src="/static/icons/close.png" alt="Stop" style="width: 20px; height: 20px;">';
    btn.className = 'btn';
    btn.style.backgroundColor = '#e5e7eb';
    btn.style.border = '1px solid #d1d5db';
    btn.onclick = stopScenario;
    
    clearFeed();
    
    // Show timeline line
    const timelineLine = document.getElementById('timeline-line');
    if (timelineLine) timelineLine.style.display = 'block';
    
    // Add start pill
    addStartPill();
    
    // Don't create ClaimsManager card - we only show sub-agents
    currentAgentName = "ClaimsManager";
    
    if (currentEventSource) currentEventSource.close();
    
    currentEventSource = new EventSource(`/api/run/${selectedScenario}`);
    
    currentEventSource.onmessage = function(event) {
        console.log("Received event:", event.data);
        try {
            const data = JSON.parse(event.data);
            handleEvent(data);
        } catch (e) {
            console.error("Error parsing event data:", e, event.data);
        }
    };
    
    currentEventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        currentEventSource.close();
        btn.disabled = false;
        btn.innerHTML = '<img src="/static/icons/play.png" alt="Play" style="width: 20px; height: 20px;">';
        btn.className = 'btn';
        btn.style.backgroundColor = '#e5e7eb';
        btn.style.border = '1px solid #d1d5db';
        btn.onclick = runScenario;
    };
    
    currentEventSource.onopen = function() {
        console.log("EventSource connection opened");
    };
}

function handleEvent(data) {
    console.log("Handling event:", data.type, data);
    
    if (data.type === 'agent_active') {
        // Skip ClaimsManager - we only show sub-agents
        if (data.agent_name === 'ClaimsManager') {
            currentAgentName = data.agent_name;
            return;
        }
        
        // Mark previous agent as completed if switching agents
        if (currentAgentName && currentAgentName !== data.agent_name && currentAgentCardId) {
            const prevStatus = document.querySelector(`#${currentAgentCardId} .agent-status`);
            const prevAvatar = document.querySelector(`#${currentAgentCardId} .agent-avatar-wrapper`);
            if (prevStatus) {
                prevStatus.className = 'agent-status completed';
                prevStatus.textContent = 'Completed';
            }
            if (prevAvatar) {
                prevAvatar.classList.remove('active');
            }
        }
        
        // Only create a new card if it's actually a different agent
        if (!currentAgentName || currentAgentName !== data.agent_name) {
            createAgentCard(data.agent_name);
        }
    } else if (data.type === 'tool_call') {
        // Check if this is a handoff to a sub-agent
        if (toolToAgentMap[data.tool_name]) {
            // Mark previous agent as completed
            const prevStatus = document.querySelector(`#${currentAgentCardId} .agent-status`);
            const prevAvatar = document.querySelector(`#${currentAgentCardId} .agent-avatar-wrapper`);
            if (prevStatus) {
                prevStatus.className = 'agent-status completed';
                prevStatus.textContent = 'Completed';
            }
            if (prevAvatar) {
                prevAvatar.classList.remove('active');
            }
            
            // Create new agent card for the sub-agent
            const newAgentName = toolToAgentMap[data.tool_name];
            activeSubAgent = newAgentName;
            createAgentCard(newAgentName);
            
            // Store the tool info for when the output comes back
            toolCallMap[data.tool_id || data.tool_name] = data;
        }
    } else if (data.type === 'internal_tool_call') {
        // Internal tool call from sub-agent
        if (currentAgentCardId && activeSubAgent) {
            const rowId = addToolRow(currentAgentCardId, data.tool_name, data.args, null, null);
            const row = document.getElementById(rowId);
            if (row) {
                // Store the full data
                row.dataset.toolData = JSON.stringify({
                    tool_name: data.tool_name,
                    arguments: data.args,
                    output: 'Tool executed successfully'
                });
                
                // Mark as completed immediately
                setTimeout(() => {
                    const icon = row.querySelector('.tool-status-icon');
                    if (icon) {
                        icon.className = 'bi bi-check-circle-fill text-success tool-status-icon';
                    }
                }, 100);
            }
        }
    } else if (data.type === 'tool_output') {
        // Check if this was a handoff tool
        const toolInfo = toolCallMap[data.tool_id || data.tool_name];
        if (toolInfo && toolToAgentMap[toolInfo.tool_name]) {
            // This is the output from a sub-agent handoff
            const agentName = toolToAgentMap[toolInfo.tool_name];
            
            // Store the agent's output
            if (!agentOutputs[agentName]) {
                agentOutputs[agentName] = [];
            }
            agentOutputs[agentName].push({
                type: 'agent_output',
                content: data.output,
                timestamp: new Date().toLocaleTimeString()
            });
            
            // Mark the sub-agent as completed
            const status = document.querySelector(`#${currentAgentCardId} .agent-status`);
            const avatar = document.querySelector(`#${currentAgentCardId} .agent-avatar-wrapper`);
            if (status) {
                status.className = 'agent-status completed';
                status.textContent = 'Completed';
            }
            if (avatar) {
                avatar.classList.remove('active');
            }
            
            // Auto-refresh Output tab if THIS agent is currently being viewed
            const detailsPanel = document.getElementById('details-panel');
            const outputTab = document.getElementById('agent-output-tab');
            // Check if the details panel is showing this specific agent
            const avatarInDetails = detailsPanel?.querySelector(`img[src*="${agentInfo[agentName]?.avatar}"]`);
            if (avatarInDetails && outputTab && outputTab.classList.contains('active')) {
                // Refresh just the Output tab content without changing focus
                refreshAgentOutput(agentName);
            }
            
            // Don't create ClaimsManager card - just update state
            currentAgentName = 'ClaimsManager';
            currentAgentCardId = null;
            activeSubAgent = null;
            
            delete toolCallMap[data.tool_id || data.tool_name];
        }
        // Sub-agent internal tool outputs are not exposed by the framework
    } else if (data.type === 'message') {
        // Capture agent messages (reasoning, analysis, etc.)
        if (currentAgentName && currentAgentName !== 'ClaimsManager') {
            if (!agentOutputs[currentAgentName]) {
                agentOutputs[currentAgentName] = [];
            }
            agentOutputs[currentAgentName].push({
                type: 'message',
                content: data.content || data.message || '',
                timestamp: new Date().toLocaleTimeString()
            });
        }
    } else if (data.type === 'final') {
        const btn = document.getElementById('run-btn');
        btn.disabled = false;
        btn.innerHTML = '<img src="/static/icons/play.png" alt="Play" style="width: 20px; height: 20px;">';
        btn.className = 'btn';
        btn.style.backgroundColor = '#e5e7eb';
        btn.style.border = '1px solid #d1d5db';
        btn.onclick = runScenario;
        currentEventSource.close();
        
        // Mark final agent as completed
        const status = document.querySelector(`#${currentAgentCardId} .agent-status`);
        const avatar = document.querySelector(`#${currentAgentCardId} .agent-avatar-wrapper`);
        if (status) {
            status.className = 'agent-status completed';
            status.textContent = 'Completed';
        }
        if (avatar) {
            avatar.classList.remove('active');
        }
        
        // Add end pill
        addEndPill();
    }
}

function addStartPill() {
    const container = document.getElementById('timeline-container');
    const pill = document.createElement('div');
    pill.className = 'timeline-pill start-pill';
    pill.innerHTML = `
        <div class="timeline-pill-dot"></div>
        <span class="badge bg-success rounded-pill px-4 py-2">
            <i class="bi bi-play-fill me-2"></i>Start
        </span>
    `;
    container.appendChild(pill);
}

function addEndPill() {
    const container = document.getElementById('timeline-container');
    const pill = document.createElement('div');
    pill.className = 'timeline-pill end-pill';
    pill.innerHTML = `
        <div class="timeline-pill-dot"></div>
        <span class="badge bg-dark rounded-pill px-4 py-2">
            <i class="bi bi-check-circle-fill me-2"></i>End
        </span>
    `;
    container.appendChild(pill);
    
    // Auto scroll to show the end pill
    const scrollContainer = document.getElementById('timeline-scroll-container');
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

function createAgentCard(agentName) {
    currentAgentName = agentName;
    const cardId = `agent-card-${Date.now()}`;
    currentAgentCardId = cardId;
    
    const info = agentInfo[agentName] || { avatar: "default.png", title: agentName, description: "" };
    const avatarUrl = `/static/avatars/${info.avatar}`;
    
    const container = document.getElementById('timeline-container');
    
    const item = document.createElement('div');
    item.className = 'agent-timeline-item';
    item.id = cardId;
    
    item.innerHTML = `
        <div class="agent-avatar-wrapper active" onclick="showAgentDetails('${agentName}')">
            <img src="${avatarUrl}" alt="${agentName}">
        </div>
        <div class="agent-card">
            <div class="agent-header" onclick="showAgentDetails('${agentName}')">
                <div>
                    <h5 class="agent-title">${info.title}</h5>
                    <small class="text-muted">${info.description}</small>
                </div>
                <span class="agent-status running"><span class="spinner-border spinner-border-sm me-1" role="status"></span>Processing</span>
            </div>
            <div class="tools-collapse-header" onclick="toggleToolsList('${cardId}')">
                <i class="bi bi-chevron-right" id="${cardId}-tools-chevron"></i>
                <span class="tools-collapse-label">Tools (<span id="${cardId}-tool-count">0</span>)</span>
            </div>
            <div class="tool-list collapsed" id="${cardId}-tools">
                <!-- Tools go here -->
            </div>
        </div>
    `;
    
    container.appendChild(item);
    
    // Extend timeline line to bottom of this agent
    setTimeout(() => {
        const timelineLine = document.getElementById('timeline-line');
        const agentAvatar = item.querySelector('.agent-avatar-wrapper');
        if (timelineLine && agentAvatar) {
            const containerRect = container.getBoundingClientRect();
            const avatarRect = agentAvatar.getBoundingClientRect();
            const newHeight = avatarRect.top + avatarRect.height / 2 - containerRect.top;
            timelineLine.style.height = newHeight + 'px';
        }
    }, 50);
    
    // Auto scroll
    const scrollContainer = document.getElementById('timeline-scroll-container');
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

function toggleToolsList(cardId) {
    const toolsList = document.getElementById(`${cardId}-tools`);
    const chevron = document.getElementById(`${cardId}-tools-chevron`);
    
    if (toolsList && chevron) {
        toolsList.classList.toggle('collapsed');
        if (toolsList.classList.contains('collapsed')) {
            chevron.className = 'bi bi-chevron-right';
        } else {
            chevron.className = 'bi bi-chevron-down';
        }
    }
}

function addToolRow(cardId, toolName, args, output, toolId) {
    const list = document.getElementById(`${cardId}-tools`);
    if (!list) return;
    
    const rowId = `tool-row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const item = document.createElement('div');
    item.className = 'tool-item';
    item.id = rowId;
    item.dataset.toolName = toolName;
    item.dataset.toolId = toolId || '';
    
    // Store initial data
    item.dataset.toolData = JSON.stringify({
        tool_name: toolName,
        arguments: args,
        output: output
    });
    
    item.innerHTML = `
        <i class="bi bi-gear-wide-connected tool-icon"></i>
        <span class="tool-name">${toolName}</span>
        <span class="tool-args-preview me-3">${args ? args.substring(0, 30) + '...' : ''}</span>
        <i class="bi bi-hourglass-split text-warning tool-status-icon"></i>
    `;
    
    item.onclick = () => {
        document.querySelectorAll('.tool-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        const data = JSON.parse(item.dataset.toolData);
        showToolDetails(data);
    };
    
    list.appendChild(item);
    
    // Update tool count
    const countElem = document.getElementById(`${cardId}-tool-count`);
    if (countElem) {
        const currentCount = parseInt(countElem.textContent) || 0;
        countElem.textContent = currentCount + 1;
    }
    
    return rowId;
}

function refreshAgentOutput(agentName) {
    // Only refresh the Output tab content, don't change the entire details panel
    const outputPane = document.getElementById('agent-output-pane');
    if (!outputPane) return;
    
    // Build output HTML from stored outputs
    let outputHtml = '';
    const outputs = agentOutputs[agentName];
    if (outputs && outputs.length > 0) {
        outputHtml = outputs.map(item => {
            if (item.type === 'message') {
                // Always try to render as markdown for better formatting
                const content = marked.parse(item.content);
                return `
                    <div class="border-bottom pb-3 mb-3">
                        <small class="text-muted d-block mb-2"><i class="bi bi-clock me-1"></i>${item.timestamp}</small>
                        <div class="markdown-content">${content}</div>
                    </div>
                `;
            } else if (item.type === 'agent_output') {
                // Render final output as formatted markdown
                const content = marked.parse(item.content);
                return `
                    <div class="pb-3 mb-3">
                        <div class="markdown-content">${content}</div>
                    </div>
                `;
            }
            return '';
        }).join('');
    } else {
        outputHtml = '<p class="text-muted">No output captured yet. Agent has not completed execution.</p>';
    }
    
    outputPane.innerHTML = outputHtml;
}

function showAgentDetails(agentName) {
    const info = agentInfo[agentName];
    const panel = document.getElementById('details-panel');
    
    // Check if we're clicking the same agent - if so, preserve the active tab
    const isSameAgent = currentlyViewedAgent === agentName;
    let activeTabId = 'instructions-tab'; // default
    
    if (isSameAgent) {
        // Preserve which tab is currently active
        const activeTab = document.querySelector('#agentTabs .nav-link.active');
        if (activeTab) {
            activeTabId = activeTab.id;
        }
    }
    
    // Update the currently viewed agent
    currentlyViewedAgent = agentName;
    
    // Get agent instructions and tools from the backend
    fetch(`/api/agent-info/${agentName}`)
        .then(res => res.json())
        .then(data => {
            const instructionsHtml = data.instructions ? marked.parse(data.instructions) : '<p class="text-muted">No instructions available.</p>';
            const toolsHtml = data.tools && data.tools.length > 0 ? 
                data.tools.map(t => `
                    <div class="mb-3">
                        <strong>${t.name}</strong>
                        <p class="text-muted small mb-0">${t.description || 'No description available'}</p>
                    </div>
                `).join('') : '<p class="text-muted">No tools configured.</p>';
            
            // Build output HTML from stored outputs
            let outputHtml = '';
            const outputs = agentOutputs[agentName];
            if (outputs && outputs.length > 0) {
                outputHtml = outputs.map(item => {
                    if (item.type === 'message') {
                        // Always try to render as markdown for better formatting
                        const content = marked.parse(item.content);
                        return `
                            <div class="border-bottom pb-3 mb-3">
                                <small class="text-muted d-block mb-2"><i class="bi bi-clock me-1"></i>${item.timestamp}</small>
                                <div class="markdown-content">${content}</div>
                            </div>
                        `;
                    } else if (item.type === 'agent_output') {
                        // Render final output as formatted markdown
                        const content = marked.parse(item.content);
                        return `
                            <div class="pb-3 mb-3">
                                <div class="markdown-content">${content}</div>
                            </div>
                        `;
                    }
                    return '';
                }).join('');
            } else {
                outputHtml = '<p class="text-muted">No output captured yet. Agent has not completed execution.</p>';
            }
            
            panel.innerHTML = `
                <div class="p-4 pb-0 text-center">
                    <img src="/static/avatars/${info.avatar}" class="rounded-circle mb-3" width="100" height="100" style="object-fit: cover; border: 4px solid #dee2e6;">
                    <h4>${info.title}</h4>
                    <p class="text-muted mb-0">${info.description}</p>
                </div>
                <ul class="nav nav-tabs px-3 mt-3" id="agentTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link ${activeTabId === 'instructions-tab' ? 'active' : ''}" id="instructions-tab" data-bs-toggle="tab" data-bs-target="#instructions-pane" type="button" role="tab"><i class="bi bi-file-text me-2"></i>Instructions</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link ${activeTabId === 'tools-tab' ? 'active' : ''}" id="tools-tab" data-bs-toggle="tab" data-bs-target="#tools-pane" type="button" role="tab"><i class="bi bi-tools me-2"></i>Tools</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link ${activeTabId === 'agent-output-tab' ? 'active' : ''}" id="agent-output-tab" data-bs-toggle="tab" data-bs-target="#agent-output-pane" type="button" role="tab"><i class="bi bi-chat-left-text me-2"></i>Output</button>
                    </li>
                </ul>
                <div class="tab-content" id="agentTabsContent">
                    <div class="tab-pane fade ${activeTabId === 'instructions-tab' ? 'show active' : ''}" id="instructions-pane" role="tabpanel">
                        <div class="markdown-content">${instructionsHtml}</div>
                    </div>
                    <div class="tab-pane fade ${activeTabId === 'tools-tab' ? 'show active' : ''}" id="tools-pane" role="tabpanel">
                        ${toolsHtml}
                    </div>
                    <div class="tab-pane fade ${activeTabId === 'agent-output-tab' ? 'show active' : ''}" id="agent-output-pane" role="tabpanel">
                        ${outputHtml}
                    </div>
                </div>
            `;
        })
        .catch(err => {
            console.error('Error loading agent info:', err);
            panel.innerHTML = `
                <div class="p-4 text-center border-bottom">
                    <img src="/static/avatars/${info.avatar}" class="rounded-circle mb-3" width="100" height="100" style="object-fit: cover; border: 4px solid #dee2e6;">
                    <h4>${info.title}</h4>
                    <p class="text-muted">${info.description}</p>
                </div>
                <div class="p-4 text-danger">Error loading agent details.</div>
            `;
        });
}

function showToolDetails(data) {
    const panel = document.getElementById('details-panel');
    
    // Check for files
    let filePreviewHtml = '';
    if (data.arguments) {
        // Try to find file paths
        // Regex for common extensions
        const matches = data.arguments.match(/['"]([^'"]+\.(pdf|png|jpg|jpeg))['"]/i);
        if (matches && matches[1]) {
            const filePath = matches[1];
            const relativePath = getRelativePath(filePath);
            if (relativePath) {
                filePreviewHtml = `
                    <div class="mt-3">
                        <h6>File Preview</h6>
                        ${renderFilePreview(relativePath)}
                    </div>
                `;
            }
        }
    }
    
    panel.innerHTML = `
        <div class="p-3 border-bottom bg-light">
            <h5 class="mb-0"><i class="bi bi-tools me-2"></i>${data.tool_name}</h5>
        </div>
        <ul class="nav nav-tabs mt-3 px-3" id="toolTabs" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="input-tab" data-bs-toggle="tab" data-bs-target="#input-pane" type="button" role="tab">Input</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="output-tab" data-bs-toggle="tab" data-bs-target="#output-pane" type="button" role="tab">Output</button>
            </li>
        </ul>
        <div class="tab-content" id="toolTabsContent">
            <div class="tab-pane fade show active" id="input-pane" role="tabpanel">
                <h6>Arguments</h6>
                <pre><code>${formatJSON(data.arguments)}</code></pre>
                ${filePreviewHtml}
            </div>
            <div class="tab-pane fade" id="output-pane" role="tabpanel">
                <h6>Result</h6>
                <div class="markdown-content">
                    <pre style="white-space: pre-wrap;">${escapeHtml(data.output || 'Pending...')}</pre>
                </div>
            </div>
        </div>
    `;
}

function formatJSON(str) {
    try {
        if (!str) return 'None';
        // If it's a tuple string like "('arg1', 'arg2')", just return it
        if (str.startsWith('(')) return str;
        const obj = JSON.parse(str);
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return str;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getRelativePath(absolutePath) {
    const parts = absolutePath.split(/[\\/]/);
    const scenariosIndex = parts.indexOf('scenarios');
    const outputsIndex = parts.indexOf('outputs');
    
    if (scenariosIndex !== -1) {
        return 'files/' + parts.slice(scenariosIndex).join('/');
    } else if (outputsIndex !== -1) {
        return 'files/' + parts.slice(outputsIndex).join('/');
    }
    return null;
}

function renderFilePreview(url) {
    const ext = url.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
        return `<img src="/${url}" class="img-preview" alt="Preview">`;
    } else if (ext === 'pdf') {
        return `<embed src="/${url}" type="application/pdf" width="100%" style="height: calc(100vh - 350px); min-height: 500px;" class="border rounded">`;
    } else {
        return `<a href="/${url}" target="_blank" class="btn btn-outline-primary"><i class="bi bi-download me-2"></i>Download File</a>`;
    }
}

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

function resetToDefault() {
    // Default theme values - natural, professional colors
    document.getElementById('appTitle').value = 'Agentic Claims Processor';
    document.getElementById('logoUrl').value = '';
    document.getElementById('navbarColor').value = '#1a3a52';
    document.getElementById('navbarTextColor').value = '#ffffff';
    document.getElementById('accentColor').value = '#2c5f8d';
    document.getElementById('backgroundColor').value = '#f5f7fa';
    document.getElementById('textColor').value = '#2d3748';
    document.getElementById('timelineColor').value = '#d1d5db';
    
    // Apply immediately
    const defaultTheme = {
        title: 'Agentic Claims Processor',
        logo: '',
        navbarColor: '#1a3a52',
        navbarTextColor: '#ffffff',
        accentColor: '#2c5f8d',
        backgroundColor: '#f5f7fa',
        textColor: '#2d3748',
        timelineColor: '#d1d5db'
    };
    
    localStorage.setItem('appTheme', JSON.stringify(defaultTheme));
    updateTheme(defaultTheme);
}

function applyTheme() {
    const theme = {
        title: document.getElementById('appTitle').value,
        logo: document.getElementById('logoUrl').value,
        navbarColor: document.getElementById('navbarColor').value,
        navbarTextColor: document.getElementById('navbarTextColor').value,
        accentColor: document.getElementById('accentColor').value,
        backgroundColor: document.getElementById('backgroundColor').value,
        textColor: document.getElementById('textColor').value,
        timelineColor: document.getElementById('timelineColor').value
    };
    
    // Save to localStorage
    localStorage.setItem('appTheme', JSON.stringify(theme));
    
    // Apply theme
    updateTheme(theme);
}

function loadTheme() {
    const savedTheme = localStorage.getItem('appTheme');
    if (savedTheme) {
        const theme = JSON.parse(savedTheme);
        
        // Update form inputs
        document.getElementById('appTitle').value = theme.title;
        document.getElementById('logoUrl').value = theme.logo || '';
        document.getElementById('navbarColor').value = theme.navbarColor || theme.primaryColor || '#1a3a52';
        document.getElementById('navbarTextColor').value = theme.navbarTextColor || '#ffffff';
        document.getElementById('accentColor').value = theme.accentColor || theme.secondaryColor || '#2c5f8d';
        document.getElementById('backgroundColor').value = theme.backgroundColor || '#f5f7fa';
        document.getElementById('textColor').value = theme.textColor || '#2d3748';
        document.getElementById('timelineColor').value = theme.timelineColor || '#d1d5db';
        
        // Apply theme
        updateTheme(theme);
    }
}

function updateTheme(theme) {
    // Support legacy field names
    const navbarColor = theme.navbarColor || theme.primaryColor || '#1a3a52';
    const navbarTextColor = theme.navbarTextColor || '#ffffff';
    const accentColor = theme.accentColor || theme.secondaryColor || '#2c5f8d';
    const backgroundColor = theme.backgroundColor || '#f5f7fa';
    const textColor = theme.textColor || '#2d3748';
    const timelineColor = theme.timelineColor || '#d1d5db';
    
    // Update title
    const brandElement = document.querySelector('.navbar-brand');
    if (theme.logo) {
        brandElement.innerHTML = `<img src="${theme.logo}" alt="Logo" style="height: 30px; margin-right: 10px;"><span style="color: ${navbarTextColor}">${theme.title}</span>`;
    } else {
        brandElement.innerHTML = `<i class="bi bi-robot me-2" style="color: ${navbarTextColor}"></i><span style="color: ${navbarTextColor}">${theme.title}</span>`;
    }
    document.title = theme.title;
    
    // Update CSS custom properties
    const root = document.documentElement;
    root.style.setProperty('--primary-color', accentColor);
    root.style.setProperty('--secondary-color', accentColor);
    root.style.setProperty('--background-color', backgroundColor);
    root.style.setProperty('--text-color', textColor);
    
    // Calculate lighter/darker shades
    const adjustColor = (color, percent) => {
        const num = parseInt(color.replace("#",""), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, Math.max(0, (num >> 16) + amt));
        const G = Math.min(255, Math.max(0, (num >> 8 & 0x00FF) + amt));
        const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
        return "#" + (0x1000000 + R*0x10000 + G*0x100 + B).toString(16).slice(1);
    };
    
    // Update Bootstrap button colors dynamically
    const style = document.createElement('style');
    style.id = 'dynamic-theme';
    const existingStyle = document.getElementById('dynamic-theme');
    if (existingStyle) existingStyle.remove();
    
    const navbarDark = adjustColor(navbarColor, -20);
    const accentLight = adjustColor(accentColor, 20);
    
    style.textContent = `
        /* Global colors */
        body {
            background-color: ${backgroundColor} !important;
            color: ${textColor} !important;
        }
        
        /* Navbar */
        #main-navbar.navbar, .navbar#main-navbar {
            background-color: ${navbarColor} !important;
            border-bottom: 2px solid ${navbarDark} !important;
        }
        #main-navbar .navbar-brand, #main-navbar .navbar-brand span, #main-navbar .navbar-brand i {
            color: ${navbarTextColor} !important;
        }
        
        /* Headings */
        h1, h2, h3, h4, h5, h6, .agent-title, .h6 {
            color: ${accentColor} !important;
        }
        
        /* Buttons */
        .btn-primary {
            background-color: ${accentColor} !important;
            border-color: ${accentColor} !important;
            color: white !important;
        }
        .btn-primary:hover {
            background-color: ${adjustColor(accentColor, -20)} !important;
            border-color: ${adjustColor(accentColor, -20)} !important;
        }
        .btn-danger {
            background-color: #dc3545 !important;
        }
        .btn-outline-secondary {
            color: ${textColor} !important;
            border-color: ${adjustColor(backgroundColor, -20)} !important;
        }
        .btn-outline-secondary:hover {
            background-color: ${adjustColor(backgroundColor, -10)} !important;
            color: ${textColor} !important;
        }
        
        /* Text colors */
        .text-primary {
            color: ${accentColor} !important;
        }
        .text-muted {
            color: ${adjustColor(textColor, 30)} !important;
        }
        
        /* Cards and borders */
        .agent-card, .card {
            border: 1px solid ${accentColor} !important;
            border-radius: 8px !important;
        }
        .border, .border-bottom, .border-end {
            border-color: ${adjustColor(backgroundColor, -15)} !important;
        }
        
        /* Agent elements */
        .agent-avatar-wrapper.active {
            border: 3px solid ${accentColor} !important;
        }
        .agent-status.running {
            color: ${accentColor} !important;
        }
        .spinner-border {
            color: ${accentColor} !important;
        }
        
        /* Timeline */
        .timeline-pill-label {
            background-color: ${accentColor} !important;
            color: white !important;
        }
        .timeline-line {
            background-color: ${timelineColor} !important;
        }
        .timeline-pill-dot {
            border-color: ${timelineColor} !important;
        }
        .agent-avatar-wrapper {
            border-color: ${timelineColor} !important;
        }
        
        /* Tabs */
        .nav-tabs .nav-link.active {
            color: ${accentColor} !important;
            border-bottom: 3px solid ${accentColor} !important;
            font-weight: 600 !important;
        }
        .nav-tabs .nav-link {
            color: ${adjustColor(textColor, 20)} !important;
        }
        
        /* Tool items */
        .tool-item.selected {
            background-color: ${accentLight}20 !important;
            border-left: 3px solid ${accentColor} !important;
        }
        
        /* Backgrounds */
        .bg-light {
            background-color: ${adjustColor(backgroundColor, -5)} !important;
        }
        .bg-white {
            background-color: ${backgroundColor} !important;
        }
        
        /* Select and inputs */
        .form-select, .form-control {
            background-color: white !important;
            color: ${textColor} !important;
            border-color: ${adjustColor(backgroundColor, -20)} !important;
        }
    `;
    
    document.head.appendChild(style);
}
