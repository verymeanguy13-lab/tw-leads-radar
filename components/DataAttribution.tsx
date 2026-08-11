export interface AttributionDataset {
  agency: string;
  name: string;
  year: string;
}

interface DataAttributionProps {
  datasets: AttributionDataset[];
  className?: string;
}

export default function DataAttribution({ datasets, className }: DataAttributionProps) {
  return (
    <div className={`text-xs text-secondary space-y-0.5 ${className ?? ""}`}>
      {datasets.map((d, i) => (
        <p key={`${d.agency}-${d.name}-${i}`}>
          {"\u63d0\u4f9b\u6a5f\u95dc\uff0f"}
          {d.agency} {d.year} {d.name}
          {"\uff0c\u4f9d\u653f\u5e9c\u8cc7\u6599\u958b\u653e\u6388\u6b0a\u689d\u6b3e\u9032\u884c\u516c\u958b\u5fb5\u96c6\u53ca\u52a0\u503c\u5229\u7528"}
        </p>
      ))}
    </div>
  );
}