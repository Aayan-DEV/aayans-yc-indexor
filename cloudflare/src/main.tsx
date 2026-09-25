import React from "react";
import { createRoot } from "react-dom/client";
import atlas from "../../public/atlas/pile.json";
import { SearchExperience } from "../../components/SearchExperience";
import "../../app/globals.css";

const icons = atlas.ids.map((id, at) => ({ id, src: atlas.srcs[at].replace(/^\/library\//, "/icons/"), at }));
for (let i = icons.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [icons[i], icons[j]] = [icons[j], icons[i]];
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SearchExperience
      icons={icons.slice(0, 1200)}
      indexed={6241}
      cloudflare
      sheet={{ url: "/atlas/pile.webp", cell: atlas.cell, gutter: atlas.gutter, cols: atlas.cols }}
    />
  </React.StrictMode>,
);
