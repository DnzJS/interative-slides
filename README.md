# interative-slides
交互式教学系统

<img width="1916" height="881" alt="微信图片_2025-07-14_111052_852" src="https://github.com/user-attachments/assets/e9a1bc05-5921-428e-926e-ae756320276a" />

## 环境要求
Linux (Ubuntu 22.04已测试)
python 3.x
tornado (可用语句pip install tornado)

## 密钥配置
请找到app.py文件中
"apiKey": "请在此填入deepseek API KEY",  # 替换为你的实际API Key
这一行：
修改相关内容为您的deepseek API密钥以使用相关AI助教服务

## 运行方法
下载项目到本地，进入主文件夹后运行：
python3 app.py

## 访问方法
学生端进入方法：
[ip]:8888
例如： localhost:8888

教师端进入方法：
[ip]:8888?role=0&password=teacher123
例如： localhost:8888?role=0&password=teacher123




[说明文档完善中……]
