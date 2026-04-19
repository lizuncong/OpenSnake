import { saveToJsonFileAsync } from '../utils/file.js'
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// index.js
import 'dotenv/config';  // 必须在最顶部导入
import OpenAI from 'openai';

// // 从环境变量读取配置
const client = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY,
  baseURL: process.env.ZHIPU_BASE_URL,
});

const MODEL_NAME = process.env.ZHIPU_MODEL;

async function chat() {
  try {
    const response = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: "你是一个专业的AI助手。" },
        { role: "user", content: "什么是AI Agent？" }
      ],
    });
    saveToJsonFileAsync(response, 'result.json', __dirname);
    console.log('response========', response.choices[0].message.content);
  } catch (error) {
    console.error("调用失败:", error);
  }
}

chat();


