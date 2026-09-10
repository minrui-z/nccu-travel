import type { Plugin } from 'vite';
/**
 * cfb 1.2.2 only assigns module.exports when a global require exists.
 * A production browser Worker has no require; Rolldown leaves that typeof guard.
 * Remove only the obsolete require guard before CommonJS conversion. The parser,
 * serializer and CFB data are untouched. verify-build executes the emitted Worker.
 * Upstream: https://github.com/SheetJS/js-cfb (cfb.js export footer).
 */
export function cfbBrowserExport(): Plugin {
  return {
    name: 'cfb-browser-export',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/cfb/cfb.js')) return null;
      const old =
        "if(typeof require !== 'undefined' && typeof module !== 'undefined' && typeof DO_NOT_EXPORT_CFB === 'undefined') { module.exports = CFB; }";
      if (!code.includes(old))
        throw new Error(
          'CFB browser export footer changed; revalidate the XLS build adapter.',
        );
      return {
        code: code.replace(
          old,
          "if(typeof module !== 'undefined' && typeof DO_NOT_EXPORT_CFB === 'undefined') { module.exports = CFB; }",
        ),
        map: null,
      };
    },
  };
}
