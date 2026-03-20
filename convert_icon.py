from PIL import Image
import sys
import os

source_path = r"C:\Users\BRB33\.gemini\antigravity\brain\4ce45d00-b243-43f4-b330-0d54b08cdc3c\zen_stock_prophet_icon_1772283747082.png"
if not os.path.exists(source_path):
    print("Source image not found!")
    sys.exit(1)

img = Image.open(source_path)
icon_sizes = [(16,16), (32, 32), (48, 48), (64,64), (128,128), (256,256)]
img.save(r"C:\Users\BRB33\OneDrive\Desktop\Antigravity\japan-stock-prophet\ZenStockProphet.ico", sizes=icon_sizes)
print("Converted to ICO")
