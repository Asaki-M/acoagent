# cronAgent

## 读取本地目录下的项目

## AI 问答项目

## Track 跟踪每一步

## 定时任务

## 自定义Workflow

## harness 架构

## Tools

## Memory
- 短期记忆：滑动窗口，限制最近5条记录
- 工作记忆：通过内置Tool来维护，让LLM自行决定记录，一般这些还要限制一些不要乱记录，例如像用户偏好等等，比如用户提出以后用中文回答，那么这就可以记录到工作记忆等，`get_work_memory`, `update_work_memory`, `clear_work_memory`

记忆储存：每一条对话记录需要添加到数据库，会根据打开的项目目录和会话id来存储，方便可以根据项目来新建会话以及用之前的历史会话

## Loop