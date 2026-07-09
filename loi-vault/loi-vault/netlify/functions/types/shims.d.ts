declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (buf: Buffer) => Promise<{ text: string }>;
  export default pdfParse;
}

declare module "word-extractor" {
  class Document {
    getBody(): string;
  }
  export default class WordExtractor {
    extract(input: Buffer | string): Promise<Document>;
  }
}
