"""Creates the sample upload files used by up.py / ui_up.py in /tmp/files."""
import os, struct, zlib
os.makedirs("/tmp/files", exist_ok=True); os.chdir("/tmp/files")
open("lecture.pdf","wb").write(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"+os.urandom(2000))
open("fake.pdf","wb").write(b"This is a text file pretending to be a PDF"*10)
open("big-photo.jpg","wb").write(b"\xff\xd8\xff\xe0"+os.urandom(6*1024*1024))       # larger than Vercel's 4.5 MB limit
def png():
    raw=b"".join(b"\x00"+b"\xff\x00\x00"*4 for _ in range(4))
    c=lambda t,d: struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    return b"\x89PNG\r\n\x1a\n"+c(b"IHDR",struct.pack(">IIBBBBB",4,4,8,2,0,0,0))+c(b"IDAT",zlib.compress(raw))+c(b"IEND",b"")
open("card.png","wb").write(png())
open("photo.webp","wb").write(b"RIFF"+struct.pack("<I",1000)+b"WEBPVP8 "+os.urandom(990))
open("fake.jpg","wb").write(b"GIF89a"+os.urandom(500))
open("huge.pdf","wb").write(b"%PDF-1.4\n"+os.urandom(16*1024*1024))                 # over the 15 MB PDF limit
