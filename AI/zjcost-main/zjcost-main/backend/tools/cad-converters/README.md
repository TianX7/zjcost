# CAD converter bundle

This folder contains bundled CAD converter executables used by the backend before it checks `PATH`, environment variables, or system install locations.

Supported executables:

- `ODAFileConverter.exe` for DXF to DWG and DWG to DXF
- `dxf2dwg.exe` and `dwg2dxf.exe` from LibreDWG

The included `libredwg` folder is the free LibreDWG Windows build. You can also set `ZJCOST_CAD_CONVERTER_DIR` to point to another bundled converter directory.

Large CAD files can take several minutes to convert. The default converter timeout is 600 seconds and can be changed with `ZJCOST_CAD_CONVERTER_TIMEOUT`.

DWG writing depends on a native converter because DWG is a proprietary binary CAD format. This project only ships the discovery and calling logic; place the licensed converter binary here when packaging the application.
