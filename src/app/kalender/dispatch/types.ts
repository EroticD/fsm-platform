export type DispatchActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type DispatchTechnician = {
  id: string;
  name: string;
};

export type DispatchWorkOrder = {
  id: string;
  title: string;
  status: string;
  customerName: string;
  address: string;
  productModel: string | null;
  description: string;
  dateRange: string;
  technicians: DispatchTechnician[];
  /** Lovlige neste statuser, beregnet med allowedTransitions på serveren. */
  statusOptions: string[];
  /** Fullføring og kansellering er egne, bekreftede handlinger. */
  canComplete: boolean;
  canCancel: boolean;
  /** Planlagt før i dag, men fortsatt åpen. */
  isOverdue: boolean;
};

export type DispatchDay = {
  date: string;
  label: string;
  /** «attention» samler forfalte og ufordelte oppdrag utenfor datofilteret. */
  kind?: "date" | "attention";
  workOrders: DispatchWorkOrder[];
};
