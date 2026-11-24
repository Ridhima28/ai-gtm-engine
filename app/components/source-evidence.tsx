export function SourceEvidence({ excerpt, url, retrievedAt }: {
  excerpt: string;
  url: string;
  retrievedAt: string;
}) {
  return (
    <>
      <blockquote className="border-l-2 border-[#dce4f4] pl-3 leading-relaxed">{excerpt}</blockquote>
      <p className="text-xs text-[#66748b]">
        <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-[#31569e] underline">Original source</a>
        {" · Retrieved "}<time dateTime={retrievedAt}>{new Date(retrievedAt).toLocaleDateString()}</time>
      </p>
    </>
  );
}
