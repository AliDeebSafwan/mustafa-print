// Applies the device's chosen theme before the first paint, so the page never flashes the wrong background.
// A plain file rather than an inline <script>: the staff app's Content-Security-Policy allows scripts from its own
// origin only. Keep the storage key in step with src/lib/theme.ts.
try {
  if (localStorage.getItem('mpe.theme') === '2100') {
    document.documentElement.dataset.theme = '2100'
    var themeColor = document.querySelector('meta[name="theme-color"]')
    if (themeColor) themeColor.setAttribute('content', '#090d16')
  }
} catch {
  // Storage blocked (private mode, site data off): the classic theme simply stays.
}
