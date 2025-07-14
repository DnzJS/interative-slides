import os
import tornado.ioloop
import tornado.web
import tornado.websocket
import time
from datetime import datetime

# 配置
PORT = 8888
TEACHER_PASSWORD = "teacher123"
STUDENT_PASSWORD = "student123"

# 全局状态
class PPTState:
    def __init__(self):
        self.current_page = 1
        self.last_updated = time.time()
        self.total_pages = self.load_total_pages()  # 根据实际PPT页数调整

    def load_total_pages(self):
        # 自动计算ppt_slides目录下的文件数
        slide_dir = "ppt_slides"
        count = len([f for f in os.listdir(slide_dir) if f.startswith("slide") and f.endswith(".html")])
        return max(count, 1)  # 至少1页

ppt_state = PPTState()

class APIKeyHandler(tornado.web.RequestHandler):
    def get(self):
        # 确保返回正确的Content-Type
        self.set_header('Content-Type', 'application/json')
        self.write({
            "apiKey": "请在此填入deepseek API KEY",  # 替换为你的实际API Key
            "apiUrl": "https://api.deepseek.com/v1/chat/completions"  # 明确指定API端点
        })

# 认证处理器
class AuthHandler(tornado.web.RequestHandler):
    def get(self):
        role = self.get_argument("role", None)
        password = self.get_argument("password", None)
        
        if role == "0" and password == TEACHER_PASSWORD:
            self.set_secure_cookie("role", "teacher")
            self.redirect("/ppt")
        else:
            self.set_secure_cookie("role", "student")
            self.redirect("/ppt")

        # elif role == "1" and password == STUDENT_PASSWORD:
        #     self.set_secure_cookie("role", "student")
        #     self.redirect("/ppt")
        # else:
        #     self.write("Invalid credentials")
        #     self.set_status(401)

# WebSocket处理器
class WSHandler(tornado.websocket.WebSocketHandler):
    connections = set()
    
    def open(self):
        WSHandler.connections.add(self)
        self.write_message({"type": "init", "current_page": ppt_state.current_page})
    
    def check_origin(self, origin):
        return True  # 允许所有跨域请求，实际部署时应限制

    # 修改on_message方法
    def on_message(self, message):
        data = tornado.escape.json_decode(message)
        role = self.get_secure_cookie("role")
        
        if not role:
            return
        
        role = role.decode("utf-8")
        
        if data.get("type") == "page_change" and role == "teacher":
            new_page = data["page"]
            if 1 <= new_page <= ppt_state.total_pages:
                ppt_state.current_page = new_page
                ppt_state.last_updated = time.time()
                self.broadcast_state()
   
    def on_close(self):
        WSHandler.connections.remove(self)
    
    @classmethod
    def broadcast_state(cls):
        state = {
            "type": "state_update",
            "current_page": ppt_state.current_page,
            "last_updated": ppt_state.last_updated
        }
        for connection in cls.connections:
            connection.write_message(state)

# PPT主界面
class PPTHandler(tornado.web.RequestHandler):
    def get(self):
        role = self.get_secure_cookie("role")
        if not role:
            self.redirect("/")
            return
        
        role = role.decode("utf-8")
        self.render("templates/ppt.html", role=role)

# 获取PPT页面
class SlideHandler(tornado.web.RequestHandler):
    def get(self, slide_num):
        try:
            slide_num = int(slide_num)
            if 1 <= slide_num <= ppt_state.total_pages:
                with open(f"ppt_slides/slide{slide_num}.html", "r") as f:
                    self.write(f.read())
            else:
                self.set_status(404)
                self.write("Slide not found")
        except (ValueError, FileNotFoundError):
            self.set_status(404)
            self.write("Slide not found")

# 获取当前状态
class StateHandler(tornado.web.RequestHandler):
    def get(self):
        self.write({
            "current_page": ppt_state.current_page,
            "last_updated": ppt_state.last_updated
        })

class SlideInfoHandler(tornado.web.RequestHandler):
    def get(self):
        self.write({
            "total_pages": ppt_state.total_pages,
            "current_page": ppt_state.current_page
        })

def make_app():
    settings = {
        "cookie_secret": "your_cookie_secret_here",
        "static_path": os.path.join(os.path.dirname(__file__), "static"),
        "debug": True
    }
    
    return tornado.web.Application([
        (r"/", AuthHandler),
        (r"/ppt", PPTHandler),
        (r"/ws", WSHandler),
        (r"/slide/([0-9]+)", SlideHandler),
        (r"/state", StateHandler),
        (r"/static/(.*)", tornado.web.StaticFileHandler, {"path": settings["static_path"]}),
        (r"/get_api_key", APIKeyHandler),
        (r"/get_slide_info", SlideInfoHandler),
        (r"/images/(.*)", tornado.web.StaticFileHandler, {"path": "ppt_slides/images"}),
        (r"/js/(.*)", tornado.web.StaticFileHandler, {"path": "static/js"}),
    ], **settings)

if __name__ == "__main__":
    app = make_app()
    app.listen(PORT)
    print(f"Server running on http://localhost:{PORT}")
    tornado.ioloop.IOLoop.current().start()
