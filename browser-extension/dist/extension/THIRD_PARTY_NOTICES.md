# Third-party and reused source notices

The read-only matrix model derives from the MIT-licensed original integration code from liangquanzhou/dify-dmn-plugin integration commit acf92a24ca45d737e90545e91d7e2d073ac35e83 (model SHA256 d127c9da4548c16288d1bf51bad2a2d521bd4c944df269a6cb75e5d8505d5238). Its MIT notice is retained in LICENSE. The remaining extension runtime implementation and synthetic sensor regression generator are original code for this extension.

No Dify frontend source, React, jsdom or esbuild runtime library is shipped in the extension bundle. Data contracts and plugin identifiers are referenced for interoperability; this release does not repackage the Brian Dify plugin.

The upstream binhuhu/dify_dmn_plugin repository did not provide an explicit license at the reviewed commit. Its sample documents and generated upstream fixtures are not redistributed in this source or runtime archive. Optional compatibility checks read those public files into a temporary directory and do not execute upstream code. This notice makes no license grant for upstream material.

Development dependencies are pinned in package-lock.json. esbuild and jsdom use MIT; TypeScript uses Apache-2.0. Transitive development dependencies retain their own licenses in their npm packages. node_modules is not included in source or extension archives.

This browser-extension directory is MIT-licensed, including the original additions, with the retained original model notice. The enclosing Workbench CLI/MCP retains its separate Apache-2.0 license and attribution.
