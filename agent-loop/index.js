// Harness: the loop -- 持续将真实的工具执行结果回传给模型
// The Agent Loop
// 这个文件展示了最小的实用编码代理模式：
//     用户消息
//       -> 模型回复
//       -> 如果有工具调用：执行工具
//       -> 将工具执行结果写回消息历史
//       -> 继续循环
// 它刻意保持循环的简洁性，同时明确暴露了循环状态，
// 以便后续章节可以基于相同的结构进行扩展。


// index.js
import 'dotenv/config';  // 必须在最顶部导入
import OpenAI from 'openai';

// // 从环境变量读取配置
// const client = new OpenAI({
//   apiKey: process.env.ZHIPU_API_KEY,
//   baseURL: process.env.ZHIPU_BASE_URL,
// });

// const MODEL_NAME = process.env.ZHIPU_MODEL;

// async function chat() {
//   try {
//     const response = await client.chat.completions.create({
//       model: MODEL_NAME,
//       messages: [
//         { role: "system", content: "你是一个专业的AI助手。" },
//         { role: "user", content: "什么是AI Agent？" }
//       ],
//     });
//     console.log('response========', response.choices[0].message.content);
//   } catch (error) {
//     console.error("调用失败:", error);
//   }
// }

// chat();


/**
 * s01_agent_loop.js - The Agent Loop (Node.js version)
 * 使用智谱 GLM-4.7-Flash 模型的编码代理循环
 */

import { createInterface } from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

const execAsync = promisify(exec);

// 智谱 API 配置
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = process.env.MODEL_ID || 'glm-4.7-flash';

// 系统提示
const SYSTEM = `你是一个编码代理，当前工作目录是: ${process.cwd()}。使用 bash 命令检查和修改工作区。先行动，然后清晰地报告结果。`;

// 工具定义
const TOOLS = [{
    type: 'function',
    function: {
        name: 'bash',
        description: '在当前工作区运行 shell 命令',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的 shell 命令' }
            },
            required: ['command']
        }
    }
}];

/**
 * 执行 bash 命令
 */
async function runBash(command) {
    const dangerous = ['rm -rf /', 'sudo', 'shutdown', 'reboot', '> /dev/'];
    if (dangerous.some(item => command.includes(item))) {
        return 'Error: Dangerous command blocked';
    }
    
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: process.cwd(),
            timeout: 120000,
            shell: true,
            maxBuffer: 50 * 1024 * 1024 // 50MB
        });
        const output = (stdout + stderr).trim();
        return output.slice(0, 50000) || '(no output)';
    } catch (error) {
        if (error.killed && error.signal === 'SIGTERM') {
            return 'Error: Timeout (120s)';
        }
        return `Error: ${error.message}`;
    }
}

/**
 * 调用智谱 API
 */
async function callZhipuAPI(messages, tools = null) {
    const requestBody = {
        model: MODEL,
        messages: messages,
        max_tokens: 8000,
        temperature: 0.7,
        stream: false
    };
    
    if (tools && tools.length > 0) {
        requestBody.tools = TOOLS;
        requestBody.tool_choice = 'auto';
    }
    
    const response = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ZHIPU_API_KEY}`
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
    }
    
    return await response.json();
}

/**
 * 从消息内容中提取文本
 */
function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim();
    }
    return '';
}

/**
 * 执行工具调用
 */
async function executeToolCalls(toolCalls) {
    const results = [];
    
    for (const toolCall of toolCalls) {
        if (toolCall.function.name !== 'bash') continue;
        
        const args = JSON.parse(toolCall.function.arguments);
        const command = args.command;
        
        console.log(`\x1b[33m$ ${command}\x1b[0m`);
        const output = await runBash(command);
        console.log(output.slice(0, 200));
        
        results.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: output
        });
    }
    
    return results;
}

/**
 * 运行单轮交互
 * @returns {boolean} 是否继续循环
 */
async function runOneTurn(state) {
    // 调用 API
    const response = await callZhipuAPI(state.messages, true);
    const assistantMessage = response.choices[0].message;
    
    // 添加 assistant 消息到历史
    state.messages.push(assistantMessage);
    
    // 检查是否需要调用工具
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        state.transitionReason = null;
        return false;
    }
    
    // 执行工具调用
    const toolResults = await executeToolCalls(assistantMessage.tool_calls);
    
    if (toolResults.length === 0) {
        state.transitionReason = null;
        return false;
    }
    
    // 添加工具结果到历史
    state.messages.push(...toolResults);
    state.turnCount++;
    state.transitionReason = 'tool_result';
    
    return true;
}

/**
 * 代理主循环
 */
async function agentLoop(state) {
    while (await runOneTurn(state)) {
        // 继续循环
    }
}

/**
 * 创建交互式命令行界面
 */
function createReadlineInterface() {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });
    
    // 启用历史记录和行编辑
    rl.setPrompt('\x1b[36ms01 >> \x1b[0m');
    
    return rl;
}

/**
 * 主函数
 */
async function main() {
    // 检查 API Key
    if (!process.env.ZHIPU_API_KEY) {
        console.error('Error: ZHIPU_API_KEY not set in environment');
        console.error('Please set it in .env file or export it');
        process.exit(1);
    }
    
    const history = [];
    const rl = createReadlineInterface();
    
    console.log('智谱编码代理已启动 (GLM-4.7-Flash)');
    console.log('输入命令，输入 q/exit/空行 退出\n');
    
    rl.prompt();
    
    rl.on('line', async (line) => {
        const query = line.trim();
        
        if (query.toLowerCase() === 'q' || query.toLowerCase() === 'exit' || query === '') {
            rl.close();
            return;
        }
        
        // 添加用户消息
        history.push({
            role: 'user',
            content: query
        });
        
        const state = {
            messages: [...history],
            turnCount: 1,
            transitionReason: null
        };
        
        try {
            await agentLoop(state);
            
            // 更新历史记录
            history.length = 0;
            history.push(...state.messages);
            
            // 打印最终回复
            const lastMessage = state.messages[state.messages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
                const finalText = extractText(lastMessage.content);
                if (finalText) {
                    console.log(finalText);
                }
            }
        } catch (error) {
            console.error('\x1b[31mError:\x1b[0m', error.message);
            // 出错时移除最后一条用户消息
            history.pop();
        }
        
        console.log();
        rl.prompt();
    });
    
    rl.on('close', () => {
        console.log('\n再见！');
        process.exit(0);
    });
}

// 优雅退出处理
process.on('SIGINT', () => {
    console.log('\n');
    process.exit(0);
});

// 运行主函数
// main().catch(console.error);