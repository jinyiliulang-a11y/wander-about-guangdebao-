export const PRODUCT_URL = import.meta.env.VITE_PRODUCT_URL?.trim() || "http://your-server.example.com/";

export const teamContacts = [
  {
    "name": "金逸",
    "email": "15967109317@163.com",
    "id": "jin",
    "photo": "images/team-jin.png"
  },
  {
    "name": "杨开良",
    "email": "young_2022@foxmail.com",
    "id": "yang",
    "photo": "images/team-yang.jpg"
  },
  {
    "name": "富明哲",
    "email": "bigfu_east@qq.com",
    "id": "fu",
    "photo": "images/team-fu.jpg"
  },
  {
    "name": "姚宇轩",
    "email": "nisdd999@qq.com",
    "id": "yao",
    "photo": "images/team-yao.jpg"
  }
] as const;
