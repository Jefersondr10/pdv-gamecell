export type SaleParticipants = {
  customerId: string | null;
  customerName: string;
  sellerUserId: string;
  sellerName: string;
  revision: number;
  status: 'completed' | 'cancelled';
};
export type ParticipantChoice = { id: string; name: string };
export type SaleParticipantsResponse = {
  current: SaleParticipants;
  clients: ParticipantChoice[];
  sellers: ParticipantChoice[];
};
