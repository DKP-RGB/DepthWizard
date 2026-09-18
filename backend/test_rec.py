import urllib.request
import io
from PIL import Image

img = Image.new('RGB', (100, 100), color='green')
buf = io.BytesIO()
img.save(buf, format='JPEG')
img_bytes = buf.getvalue()

boundary = '----Boundary123'
body = (
    f'--{boundary}\r\n'
    f'Content-Disposition: form-data; name="file"; filename="test.jpg"\r\n'
    f'Content-Type: image/jpeg\r\n\r\n'
).encode('utf-8') + img_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')

req = urllib.request.Request(
    'http://localhost:8000/api/reconstruct',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST'
)

try:
    res = urllib.request.urlopen(req)
    print("STATUS:", res.status)
    import json
    data = json.loads(res.read().decode('utf-8'))
    print("KEYS:", data.keys())
except Exception as e:
    print("ERROR:", e)
