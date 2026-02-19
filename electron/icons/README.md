# Application Icons

Place the following icon files in this directory:

1. **icon.png** - Main application icon (256x256 or larger, PNG format)
2. **icon.ico** - Windows application icon (ICO format with multiple sizes)
3. **tray-icon.png** - System tray icon (16x16 or 32x32, PNG format)

## Creating Icons

You can use the `icon.svg` file as a base to create the PNG and ICO files:

### Using ImageMagick (if installed):
```bash
# Create PNG
magick icon.svg -resize 256x256 icon.png

# Create tray icon
magick icon.svg -resize 32x32 tray-icon.png

# Create ICO with multiple sizes
magick icon.svg -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Using online tools:
1. Go to https://cloudconvert.com/svg-to-png
2. Upload icon.svg
3. Convert to PNG at 256x256
4. For ICO, use https://convertico.com/

## Temporary Workaround

If no icons are provided, the app will use a default Electron icon.
