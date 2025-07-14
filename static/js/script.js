// EventSource Polyfill for streaming
class EventSourcePolyfill {
    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.onmessage = options.onmessage || function() {};
        this.onerror = options.onerror || function() {};
        this.controller = new AbortController();
        
        this.connect();
    }
    
    connect() {
        fetch(this.url, {
            method: this.options.method || 'GET',
            headers: this.options.headers,
            body: this.options.body,
            signal: this.controller.signal
        }).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
            const processChunk = ({done, value}) => {
                if (done) {
                    this.onmessage({data: '[DONE]'});
                    return;
                }
                
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        this.onmessage({data: line.substring(6)});
                    }
                });
                
                return reader.read().then(processChunk);
            };
            
            return reader.read().then(processChunk);
        }).catch(err => {
            this.onerror(err);
        });
    }
    
    close() {
        this.controller.abort();
    }
}

$(document).ready(function() {
    const role = $('body').data('role');
    let currentPage = 1;
    let totalPages = 10;
    let ws;
    let llmContext = "";
    let contextAdded = false;
    let deepseekApiKey = "";
    let chatHistory = [];
    
    // 初始化时获取API Key
    function getApiKey() {
        return fetch('/get_api_key')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data.apiKey && data.apiUrl) {
                    deepseekApiKey = data.apiKey;
                    deepseekApiUrl = data.apiUrl;
                    console.log("API配置加载成功");
                    return true;
                }
                throw new Error("Invalid API configuration");
            })
            .catch(error => {
                console.error('Error fetching API config:', error);
                appendAIMessage("错误: 无法获取API配置");
                return false;
            });
    }
    
    // 初始化WebSocket
    function initWebSocket() {
        ws = new WebSocket(`ws://${window.location.host}/ws`);
        
        ws.onopen = function() {
            console.log("WebSocket connection established");
        };
        
        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            if (data.type === "init") {
                currentPage = data.current_page;
                updateSlide();
            } else if (data.type === "state_update") {
                if (data.current_page !== currentPage) {
                    currentPage = data.current_page;
                    updateSlide();
                }
            }
        };
        
        ws.onclose = function() {
            console.log("WebSocket connection closed, reconnecting...");
            setTimeout(initWebSocket, 1000);
        };
        
        ws.onerror = function(error) {
            console.error("WebSocket error:", error);
        };
    }
    
    // 更新幻灯片
    function updateSlide() {
        // 隐藏学生端的导航按钮
        if (role === 'student') {
            $('.nav-buttons').hide();
        } else {
            $('.nav-buttons').show();
        }
        
        $('#slide-frame').attr('src', `/slide/${currentPage}`);
        $('#page-indicator').text(`${currentPage}/${totalPages}`);
        
        // 重置聊天状态
        $('#chat-messages').empty();
        contextAdded = false;
        chatHistory = [];
        
        // 获取新页面的LLM上下文
        setTimeout(() => {
            const frame = document.getElementById('slide-frame');
            if (frame) {
                frame.contentWindow.postMessage({type: "get_llm_context"}, '*');
            }
        }, 500);
    }
    
    // 监听来自iframe的消息
    window.addEventListener('message', function(event) {
        if (event.data.type === "llm_context") {
            llmContext = event.data.context;
            console.log("LLM Context received:", llmContext.substring(0, 50) + "...");
        }
    });
    
    // 导航按钮事件
    $('#prev-btn').click(function() {
        if (currentPage > 1 && role === 'teacher') {
            navigateTo(currentPage - 1);
        }
    });
    
    $('#next-btn').click(function() {
        if (currentPage < totalPages && role === 'teacher') {
            navigateTo(currentPage + 1);
        }
    });
    
    function navigateTo(page) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "page_change",
                page: page
            }));
        } else {
            console.error("WebSocket not ready");
        }
    }
    
    // 学生端自动同步
    if (role === 'student') {
        setInterval(() => {
            fetch('/state')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.current_page !== currentPage) {
                        currentPage = data.current_page;
                        updateSlide();
                    }
                })
                .catch(error => {
                    console.error('Error fetching state:', error);
                });
        }, 2000);
    }
    
    // 聊天功能
    $('#send-btn').click(sendMessage);
    $('#user-input').keypress(function(e) {
        if (e.which === 13) {
            sendMessage();
        }
    });
    
    function sendMessage() {
        const message = $('#user-input').val().trim();
        if (!message) return;
        
        // 显示用户消息
        $('#chat-messages').append(
            `<div class="message user-message">${message}</div>`
        );
        $('#user-input').val('');
        
        // 滚动到底部
        scrollChatToBottom();
        
        // 构建消息历史
        if (!contextAdded && llmContext) {
            chatHistory.push({
                role: "system",
                content: `你是一个AI助教。当前PPT页面内容: ${llmContext}。请根据当前页面内容精确简短地回答学生问题。不要使用markdown格式回答。`
            });
            contextAdded = true;
            console.log("System context added to chat history");
        }
        
        chatHistory.push({
            role: "user",
            content: message
        });
        
        console.log("Sending to DeepSeek:", {
            model: "deepseek-chat",
            messages: chatHistory,
            stream: true
        });
        
        // 调用DeepSeek API
        callDeepSeekAPI();
    }

    function callDeepSeekAPI() {
        if (!deepseekApiKey || !deepseekApiUrl) {
            appendAIMessage("错误: API配置不完整");
            console.error("API配置不完整", {deepseekApiKey, deepseekApiUrl});
            return;
        }

        const messageElement = $(`
            <div class="message ai-message">
                <div class="streaming-content">思考中...</div>
                <div class="streaming-cursor"></div>
            </div>
        `);
        $('#chat-messages').append(messageElement);
        scrollChatToBottom();

        const streamingContent = messageElement.find('.streaming-content');
        const streamingCursor = messageElement.find('.streaming-cursor');
        let fullResponse = "";
        
        // 显示加载指示器
        streamingCursor.show();

        // 添加请求负载日志
        const requestPayload = {
            model: "deepseek-chat",
            messages: chatHistory,
            stream: true,
            temperature: 0.7
        };
        console.log("API请求负载:", JSON.stringify(requestPayload, null, 2));

        // 使用fetch API进行流式处理
        fetch(deepseekApiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${deepseekApiKey}`,
                "Accept": "text/event-stream"
            },
            body: JSON.stringify(requestPayload)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(`API错误: ${response.status} - ${errData.error?.message || '未知错误'}`);
                });
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            function readChunk() {
                return reader.read().then(({done, value}) => {
                    if (done) {
                        streamingCursor.hide();
                        chatHistory.push({
                            role: "assistant",
                            content: fullResponse
                        });
                        console.log("流式传输完成");
                        return;
                    }
                    
                    const chunk = decoder.decode(value, {stream: true});
                    try {
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                const data = JSON.parse(line.substring(6));
                                if (data.choices?.[0]?.delta?.content) {
                                    fullResponse += data.choices[0].delta.content;
                                    streamingContent.text(fullResponse);
                                    scrollChatToBottom();
                                }
                            }
                        }
                    } catch (err) {
                        console.error("解析错误:", err, "原始数据:", chunk);
                    }
                    
                    return readChunk();
                });
            }
            
            return readChunk();
        })
        .catch(error => {
            console.error("API请求失败:", error);
            streamingContent.html(`<span style="color:red">请求失败: ${error.message}</span>`);
            streamingCursor.hide();
        });
    }
    
    
    function scrollChatToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
    
    function appendAIMessage(content) {
        $('#chat-messages').append(
            `<div class="message ai-message">${content}</div>`
        );
        scrollChatToBottom();
    }
    
    // 初始化
    getApiKey();
    initWebSocket();
    updateSlide();
    
    // 添加调试日志
    console.log("Initialization complete", {role, currentPage});
});

// 修改初始化部分
async function initialize() {
    try {
        const apiLoaded = await getApiKey();
        if (!apiLoaded) {
            appendAIMessage("系统初始化失败: 无法加载API配置");
            return;
        }
        
        initWebSocket();
        updateSlide();
        console.log("初始化完成", {
            role,
            apiUrl: deepseekApiUrl,
            currentPage
        });
    } catch (error) {
        console.error("初始化错误:", error);
        appendAIMessage("系统初始化错误");
    }
}

// 初始化时获取总页数
async function get_pages() {
    const res = await fetch('/get_slide_info');
    const data = await res.json();
    totalPages = data.total_pages;
    return totalPages;
}


// 替换原来的初始化调用
initialize();