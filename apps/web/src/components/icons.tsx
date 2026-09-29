/** Small line icons, drawn for this site. Decorative: always paired with visible text. */
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const ProofIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="m9 14 2 2 4-4" /></svg>
);
export const TrackIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></svg>
);
export const CashIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9.5v.01M18 14.5v.01" /></svg>
);
export const BagIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const PhoneIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><path d="M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2L20 15.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
);
export const PinIcon = ({ className }: { className?: string }) => (
  <svg {...base} className={className}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 32 32" className={className} fill="currentColor"><path d="M16.02 3C9.4 3 4.03 8.37 4.03 14.99c0 2.36.68 4.56 1.86 6.42L4 29l7.77-1.83a11.96 11.96 0 0 0 4.25 1.02h.01c6.62 0 11.99-5.37 11.99-11.99C28.03 8.37 22.64 3 16.02 3Zm0 21.9h-.01c-1.5 0-2.97-.4-4.25-1.16l-.3-.18-4.6 1.08 1.22-4.49-.2-.32a9.9 9.9 0 0 1-1.52-5.28c0-5.5 4.47-9.97 9.97-9.97 5.49 0 9.96 4.47 9.96 9.96 0 5.5-4.47 9.96-9.97 9.96Zm5.47-7.46c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.49-.9-.8-1.5-1.78-1.67-2.08-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35Z" /></svg>
);
