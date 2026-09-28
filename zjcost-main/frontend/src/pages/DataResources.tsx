import { useState } from "react";
import { Tabs } from "antd";
import { ReadOutlined, CloudSyncOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import QuotaLibrary from "./QuotaLibrary";
import PriceManagement from "./PriceManagement";

export default function DataResources() {
  const [activeKey, setActiveKey] = useState("quota");

  return (
    <div className="page-container">
      <PageHeader
        icon="database"
        title="数据资源"
        subtitle="统一管理定额库与市场价信息，为清单计价提供数据支撑。"
      />

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: "quota",
            label: (
              <span>
                <ReadOutlined />
                定额与工料机
              </span>
            ),
            children: <QuotaLibrary />,
          },
          {
            key: "price",
            label: (
              <span>
                <CloudSyncOutlined />
                市场价信息
              </span>
            ),
            children: <PriceManagement />,
          },
        ]}
      />
    </div>
  );
}
