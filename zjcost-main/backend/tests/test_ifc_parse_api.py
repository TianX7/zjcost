from io import BytesIO
import time

from app.api.routes import ifc_parse


MINIMAL_IFC = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('minimal.ifc','2026-06-05T00:00:00',('ZhuHeng'),(''),'IfcOpenShell','IfcOpenShell','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Tester',$,$,$,$,$);
#2=IFCORGANIZATION($,'ZJCost',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','ZJCost Test','ZJCOST');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,#3,#4,0);
#6=IFCDIRECTION((1.,0.,0.));
#7=IFCDIRECTION((0.,0.,1.));
#8=IFCCARTESIANPOINT((0.,0.,0.));
#9=IFCAXIS2PLACEMENT3D(#8,#7,#6);
#10=IFCDIRECTION((0.,1.,0.));
#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,#10);
#12=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);
#13=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#14=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#16=IFCUNITASSIGNMENT((#13,#14,#15));
#17=IFCPROJECT('2AyG2X0sb16Bjd4gQc07yZ',#5,'Minimal IFC',$,$,$,$,(#11),#16);
ENDSEC;
END-ISO-10303-21;
"""

MULTI_ELEMENT_IFC = b"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('multi.ifc','2026-06-05T00:00:00',('ZhuHeng'),(''),'IfcOpenShell','IfcOpenShell','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'Tester',$,$,$,$,$);
#2=IFCORGANIZATION($,'ZJCost',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','ZJCost Test','ZJCOST');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,#3,#4,0);
#6=IFCDIRECTION((1.,0.,0.));
#7=IFCDIRECTION((0.,0.,1.));
#8=IFCCARTESIANPOINT((0.,0.,0.));
#9=IFCAXIS2PLACEMENT3D(#8,#7,#6);
#10=IFCDIRECTION((0.,1.,0.));
#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,#10);
#12=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);
#13=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#14=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#16=IFCUNITASSIGNMENT((#13,#14,#15));
#17=IFCPROJECT('2AyG2X0sb16Bjd4gQc07yZ',#5,'Minimal IFC',$,$,$,$,(#11),#16);
#20=IFCCARTESIANPOINT((0.,0.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,$,$);
#22=IFCLOCALPLACEMENT($,#21);
#23=IFCCARTESIANPOINT((5.,0.,0.));
#24=IFCAXIS2PLACEMENT3D(#23,$,$);
#25=IFCLOCALPLACEMENT($,#24);
#26=IFCCARTESIANPOINT((0.,5.,0.));
#27=IFCAXIS2PLACEMENT3D(#26,$,$);
#28=IFCLOCALPLACEMENT($,#27);
#29=IFCCARTESIANPOINT((5.,5.,0.));
#30=IFCAXIS2PLACEMENT3D(#29,$,$);
#31=IFCLOCALPLACEMENT($,#30);
#40=IFCCOLUMN('0BTBFw6f90Nfh9rP1dlXr1',#5,'C1',$,$,#22,$,$,$);
#41=IFCBEAM('0BTBFw6f90Nfh9rP1dlXr2',#5,'B1',$,$,#25,$,$,$);
#42=IFCSLAB('0BTBFw6f90Nfh9rP1dlXr3',#5,'S1',$,$,#28,$,$,$);
#43=IFCBUILDINGELEMENTPROXY('0BTBFw6f90Nfh9rP1dlXr4',#5,'P1',$,$,#31,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
"""


def test_ifc_upload_can_be_polled_to_terminal_state_without_immediate_failure(client):
    response = client.post(
        "/api/ifc-parse",
        files={"file": ("minimal.ifc", BytesIO(MINIMAL_IFC), "application/octet-stream")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["taskId"]
    assert payload["status"] in {"processing", "done"}

    result = payload
    for _ in range(60):
        poll = client.get(f"/api/ifc-parse/{payload['taskId']}")
        assert poll.status_code == 200
        result = poll.json()
        if result["status"] != "processing":
            break
        time.sleep(0.1)

    assert result["status"] == "done"
    assert result["ifc_schema"] == "IFC4"
    assert result["total_elements"] == 0
    assert result["preview_elements"] == []


def test_ifc_upload_returns_all_physical_preview_elements(client):
    response = client.post(
        "/api/ifc-parse",
        files={"file": ("multi.ifc", BytesIO(MULTI_ELEMENT_IFC), "application/octet-stream")},
    )

    assert response.status_code == 200
    payload = response.json()

    result = payload
    for _ in range(60):
        poll = client.get(f"/api/ifc-parse/{payload['taskId']}")
        assert poll.status_code == 200
        result = poll.json()
        if result["status"] != "processing":
            break
        time.sleep(0.1)

    assert result["status"] == "done"
    assert result["detail_element_count"] == 4
    assert result["preview_element_count"] == 4
    assert result["aggregated_element_count"] == 4
    assert {item["type"] for item in result["preview_elements"]} == {
        "IfcColumn",
        "IfcBeam",
        "IfcSlab",
        "IfcBuildingElementProxy",
    }


def test_ifc_upload_rejects_oversized_file_without_parsing(client, monkeypatch):
    monkeypatch.setattr(ifc_parse, "_IFC_MAX_UPLOAD_MB", 1)
    payload = b"ISO-10303-21;\n" + (b"x" * (1024 * 1024 + 1))

    response = client.post(
        "/api/ifc-parse",
        files={"file": ("large.ifc", BytesIO(payload), "application/octet-stream")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert "1MB" in body["error"]


def test_ifc_parse_mode_uses_thread_inside_frozen_app(monkeypatch):
    monkeypatch.delenv("ZJCOST_IFC_PARSE_MODE", raising=False)
    monkeypatch.setattr(ifc_parse.sys, "frozen", True, raising=False)

    assert ifc_parse._ifc_parse_mode() == "thread"


def test_ifc_parse_mode_forces_thread_inside_frozen_app(monkeypatch):
    monkeypatch.setenv("ZJCOST_IFC_PARSE_MODE", "process")
    monkeypatch.setattr(ifc_parse.sys, "frozen", True, raising=False)

    assert ifc_parse._ifc_parse_mode() == "thread"


def test_ifc_parse_mode_forces_thread_in_portable_app(monkeypatch):
    monkeypatch.setenv("ZJCOST_IFC_PARSE_MODE", "process")
    monkeypatch.setenv("ZJCOST_PORTABLE", "1")
    monkeypatch.setattr(ifc_parse.sys, "frozen", False, raising=False)

    assert ifc_parse._ifc_parse_mode() == "thread"


def test_ifc_parse_mode_env_override_outside_packaged_app(monkeypatch):
    monkeypatch.setenv("ZJCOST_IFC_PARSE_MODE", "process")
    monkeypatch.delenv("ZJCOST_PORTABLE", raising=False)
    monkeypatch.setattr(ifc_parse.sys, "frozen", False, raising=False)

    assert ifc_parse._ifc_parse_mode() == "process"
