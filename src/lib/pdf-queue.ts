import prisma from "@/lib/prisma";
import { extractPdfText } from "@/lib/pdf-text";

/**
 * Enkel tekstuttrekks-kø i prosessen.
 *
 * OCR av en stor, skannet PDF kan ta minutter. Å gjøre det inne i en server
 * action blokkerer hele Node-prosessen mens det står på. Her legges jobben i en
 * kø som kjøres etter at svaret er sendt, én om gangen.
 *
 * Køen lever bare i denne prosessen; kjører man flere app-instanser, bør den
 * flyttes til en egnet jobbkø.
 */

type Job = { documentId: string; filePath: string };

const MAX_QUEUE = 200;
const queue: Job[] = [];
let running = false;

export function enqueuePdfText(documentId: string, filePath: string) {
  if (queue.length >= MAX_QUEUE) {
    console.warn(
      `Tekstuttrekk-køen er full (${MAX_QUEUE}); hopper over dokument ${documentId}.`,
    );
    return;
  }
  queue.push({ documentId, filePath });
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      try {
        const { text, pages } = await extractPdfText(job.filePath);
        await prisma.document.update({
          where: { id: job.documentId },
          data: {
            contentText: text || null,
            pageTexts: pages.length > 0 ? JSON.stringify(pages) : null,
          },
        });
      } catch (error) {
        console.error(`Tekstuttrekk feilet for dokument ${job.documentId}:`, error);
      }
    }
  } finally {
    running = false;
  }
}
