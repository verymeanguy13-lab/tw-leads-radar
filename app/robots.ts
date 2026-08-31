import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/searches", "/account", "/admin"],
    },
    sitemap: "https://www.taiwanleads.com/sitemap.xml",
  };
}
