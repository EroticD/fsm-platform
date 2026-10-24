-- Prisma 7 bruker primærnøkkel i stedet for en unik indeks på de implisitte
-- mange-til-mange-tabellene. Strukturen er ellers den samme, og den gamle
-- unike indeksen sikrer at det ikke finnes duplikater før byttet.
ALTER TABLE "_DocumentTagRelation" ADD CONSTRAINT "_DocumentTagRelation_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_DocumentTagRelation_AB_unique";

ALTER TABLE "_WorkOrderTags" ADD CONSTRAINT "_WorkOrderTags_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_WorkOrderTags_AB_unique";

ALTER TABLE "_WorkOrderTechnicians" ADD CONSTRAINT "_WorkOrderTechnicians_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_WorkOrderTechnicians_AB_unique";

ALTER TABLE "_WorkOrderTemplates" ADD CONSTRAINT "_WorkOrderTemplates_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_WorkOrderTemplates_AB_unique";
