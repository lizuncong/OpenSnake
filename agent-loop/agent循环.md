## 从一个贪吃蛇游戏开始演进


### FAQ
#### 传给LLM接口的messages为什么需要规范化？什么是规范化？
- 如何规范化？
  + 定义统一的消息格式（内部规范），为每个LLM提供商写一个转换函数：internal_messages -> provider_specific_messages
  + 使用开源SDK，比如：LangChain，LlamaIndex，LiteLLM