#!/usr/bin/env python3
"""Write a single-file release of the fare map for offline use."""

import argparse
import base64
import re
from pathlib import Path


DIST = Path(__file__).resolve().parents[1] / "dist"


def replace_once(text, original, replacement):
    if text.count(original) != 1:
        raise ValueError(f"Expected one occurrence of {original!r}")
    return text.replace(original, replacement)


def build():
    html = (DIST / "index.html").read_text()
    styles = (DIST / "styles.css").read_text()
    mark = base64.b64encode((DIST / "mark.svg").read_bytes()).decode("ascii")
    marker_url = "data:image/svg+xml;base64," + mark
    html = html.replace("./mark.svg", marker_url)
    html = replace_once(html, '<link rel="stylesheet" href="./styles.css">', f"<style>\n{styles}</style>")
    html = replace_once(html, '<script type="module" src="./app.mjs"></script>\n', "")

    modules = []
    for name in ("fares.mjs", "map.mjs", "app.mjs"):
        source = (DIST / name).read_text()
        source = re.sub(r'^import [^\n]+ from "\./[^"]+";\n', "", source, flags=re.MULTILINE)
        source = re.sub(r"^export ", "", source, flags=re.MULTILINE)
        modules.append(source)
    modules[-1] = replace_once(
        modules[-1],
        '''const response = await fetch("./network.json");
  if (!response.ok) throw new Error("Line data is unavailable (" + response.status + ")");
  createApplication(await response.json());''',
        '''const network = JSON.parse(element("embedded-network").textContent);
  createApplication(network);''',
    )
    bundle = "\n".join(modules)
    if "</script" in bundle.lower() or "</style" in styles.lower():
        raise ValueError("An inline asset contains a closing HTML tag")
    network = (DIST / "network.json").read_text().replace("<", r"\u003c")
    inline = f'''<script type="application/json" id="embedded-network">{network}</script>
<script type="module">
{bundle}</script>
'''
    return replace_once(html, "</body>", inline + "</body>")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(build(), encoding="utf-8")


if __name__ == "__main__":
    main()
