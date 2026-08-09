export interface DatasetSource {
  id: string;
  nameZh: string;
  datasetId: string;
  pageUrl: string;
  entityType: "company" | "business";
  changeType: "new" | "change" | "dissolve";
  expectedCadenceDays: number;
}

export const DATASET_SOURCES: DatasetSource[] = [
  { id: "company_new", nameZh: "\u516c\u53f8\u8a2d\u7acb\u767b\u8a18\u6e05\u518a", datasetId: "6047", pageUrl: "https://data.gov.tw/dataset/6047", entityType: "company", changeType: "new", expectedCadenceDays: 45 },
  { id: "company_change", nameZh: "\u516c\u53f8\u8b8a\u66f4\u767b\u8a18\u6e05\u518a", datasetId: "6048", pageUrl: "https://data.gov.tw/dataset/6048", entityType: "company", changeType: "change", expectedCadenceDays: 45 },
  { id: "company_dissolve", nameZh: "\u516c\u53f8\u89e3\u6563\u767b\u8a18\u6e05\u518a", datasetId: "6049", pageUrl: "https://data.gov.tw/dataset/6049", entityType: "company", changeType: "dissolve", expectedCadenceDays: 45 },
  { id: "business_new", nameZh: "\u5546\u696d\u8a2d\u7acb\u767b\u8a18\u6e05\u518a", datasetId: "6668", pageUrl: "https://data.gov.tw/dataset/6668", entityType: "business", changeType: "new", expectedCadenceDays: 45 },
  { id: "business_change", nameZh: "\u5546\u696d\u8b8a\u66f4\u767b\u8a18\u6e05\u518a", datasetId: "6669", pageUrl: "https://data.gov.tw/dataset/6669", entityType: "business", changeType: "change", expectedCadenceDays: 45 },
  { id: "business_dissolve", nameZh: "\u5546\u696d\u6b47\u696d\u767b\u8a18\u6e05\u518a", datasetId: "6670", pageUrl: "https://data.gov.tw/dataset/6670", entityType: "business", changeType: "dissolve", expectedCadenceDays: 75 },
];