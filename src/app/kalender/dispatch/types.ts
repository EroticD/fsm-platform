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
};

export type DispatchDay = {
  date: string;
  label: string;
  workOrders: DispatchWorkOrder[];
};
