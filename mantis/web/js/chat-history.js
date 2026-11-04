/** Whitelist saved transcript data; personal photo bytes never enter history. */
export function archiveExchange(question, result, photo) {
  return [
    {
      role: "user",
      content: question,
      photo: photo ? (photo.sample ? "sample" : "omitted") : "",
    },
    {
      role: "assistant",
      content: result.answer,
      demo: Boolean(result.demo),
      insufficient_evidence: Boolean(result.insufficient_evidence),
      sources: (result.sources || []).map(
        ({ document_id, name, page, text }) => ({
          document_id,
          name,
          page,
          text,
        }),
      ),
    },
  ];
}
