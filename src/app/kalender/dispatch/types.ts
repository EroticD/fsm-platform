export type DispatchActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type DispatchTechnician = {
  id: string;
  name: string;
};

export type DispatchVisit = {
  /** Visittens id. Kortet representerer én tidsblokk, ikke hele oppdraget. */
  id: string;
  workOrderId: string;
  title: string;
  /** Oppdragets status, brukt til farge og statusmerke. */
  workOrderStatus: string;
  /** Visittens status (PLANNED, ASSIGNED, ON_SITE …). */
  visitStatus: string;
  customerName: string;
  address: string;
  productModel: string | null;
  description: string;
  /** Lokalisert «fre. 30. okt.» for kortet. */
  dateLabel: string;
  /** Lokalisert klokkeslett eller «Hele dagen». */
  timeLabel: string;
  technicians: DispatchTechnician[];
  /** Lovlige neste visittstatusser, beregnet på serveren. */
  statusOptions: string[];
};

export type DispatchDay = {
  date: string;
  label: string;
  visits: DispatchVisit[];
};

/** Kompakt rad for forfalte/ufordelte oppdrag utenfor datoperioden. */
export type DispatchAttentionItem = {
  id: string;
  title: string;
  customerName: string;
  dateRange: string;
  isOverdue: boolean;
  technicians: DispatchTechnician[];
};
