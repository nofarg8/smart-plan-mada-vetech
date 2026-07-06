declare module 'html2pdf.js' {
  interface Html2PdfWorker {
    set(opt: unknown): Html2PdfWorker;
    from(element: HTMLElement): Html2PdfWorker;
    toPdf(): Html2PdfWorker;
    get(type: string): Promise<unknown>;
    outputPdf(type: string): Promise<string>;
    output(type: string): Promise<Blob | string>;
    save(): Promise<void>;
  }
  function html2pdf(): Html2PdfWorker;
  export default html2pdf;
}
