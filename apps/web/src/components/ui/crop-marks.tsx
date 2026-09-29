/** Corner crop marks. Logical utilities (start/end) keep them correct in both RTL and LTR. */
export function CropMarks() {
  const mark = "absolute size-4 border-ink";
  return (
    <>
      <span aria-hidden className={`${mark} start-0 top-0 border-s border-t`} />
      <span aria-hidden className={`${mark} end-0 top-0 border-e border-t`} />
      <span aria-hidden className={`${mark} start-0 bottom-0 border-s border-b`} />
      <span aria-hidden className={`${mark} end-0 bottom-0 border-e border-b`} />
    </>
  );
}
