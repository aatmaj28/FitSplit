import { baths, type Listing } from "../../data/listings";
import type { Application } from "../../data/store";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** A one-page PDF of a group application: the listing, who takes which room, each share, total = rent. */
export async function downloadSummary(app: Application, l: Listing): Promise<void> {
  const { jsPDF } = await import("jspdf"); // loaded on first use only
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const M = 56;
  let y = 64;
  const sent = new Date(app.submittedAt);
  const date = sent.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  doc.setFillColor(232, 85, 62);
  doc.rect(0, 0, W, 8, "F");
  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(15, 23, 42);
  doc.text("Group application", M, y);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100, 116, 139);
  doc.text(`Sent ${date} through Roombae  ·  floor plan, rent split and checks by FitSplit`, M, (y += 18));

  // the listing
  y += 30;
  doc.setDrawColor(226, 232, 240).setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - 2 * M, 64, 8, 8, "FD");
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(15, 23, 42);
  doc.text(l.title, M + 16, y + 26);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(71, 85, 105);
  doc.text(`${l.location}  ·  ${l.beds} bed  ·  ${baths(l.baths)}  ·  ${l.sqft.toLocaleString("en-US")} sq ft`, M + 16, y + 44);
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(15, 23, 42);
  doc.text(`${money(app.rent)}/mo`, W - M - 16, y + 26, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(100, 116, 139);
  doc.text(app.method === "fair" ? "fair split (room size + private bath)" : "split by room size", W - M - 16, y + 44, { align: "right" });

  // roommates, rooms, shares
  y += 96;
  const cols = [M, M + 200, W - M];
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(100, 116, 139);
  doc.text("ROOMMATE", cols[0], y);
  doc.text("ROOM", cols[1], y);
  doc.text("MONTHLY SHARE", cols[2], y, { align: "right" });
  doc.setDrawColor(226, 232, 240).line(M, (y += 8), W - M, y);
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(15, 23, 42);
  for (const m of app.members) {
    y += 24;
    doc.text(m.name, cols[0], y);
    doc.setTextColor(71, 85, 105).text(m.roomLabel, cols[1], y);
    doc.setTextColor(15, 23, 42).text(money(m.share), cols[2], y, { align: "right" });
  }
  doc.line(M, (y += 12), W - M, y);
  const total = app.members.reduce((s, m) => s + m.share, 0);
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total", cols[0], (y += 22));
  doc.text(`${money(total)}${total === app.rent ? " = rent" : ""}`, cols[2], y, { align: "right" });

  // the message to the agent
  if (app.message) {
    y += 40;
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(100, 116, 139).text("MESSAGE TO THE AGENT", M, y);
    doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(app.message, W - 2 * M), M, (y += 16), { lineHeightFactor: 1.45 });
  }

  doc.setFontSize(8.5).setTextColor(148, 163, 184);
  doc.text(`Application ${app.id}`, M, doc.internal.pageSize.getHeight() - 40);
  doc.save(`group-application-${l.id}.pdf`);
}
