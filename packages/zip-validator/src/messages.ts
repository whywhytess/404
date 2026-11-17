/**
 * Plain-language messages for every rejection and warning (FR-14, FR-15, NFR-U2):
 * each names the file (when there is one) and says how to fix the problem.
 */
import type { UploadLimits } from '@webcove/shared';
import { CONTENT_TYPES } from '@webcove/shared';

export type ErrorCode =
  | 'NOT_A_ZIP'
  | 'ARCHIVE_TOO_LARGE'
  | 'EMPTY_ARCHIVE'
  | 'TOO_MANY_FILES'
  | 'FILE_TOO_LARGE'
  | 'TOTAL_TOO_LARGE'
  | 'COMPRESSION_RATIO'
  | 'ABSOLUTE_PATH'
  | 'PARENT_PATH'
  | 'BACKSLASH_PATH'
  | 'INVALID_NAME'
  | 'ENCODING'
  | 'SYMLINK'
  | 'SPECIAL_FILE'
  | 'FORBIDDEN_TYPE'
  | 'DUPLICATE_PATH'
  | 'CASE_CONFLICT'
  | 'ENCRYPTED'
  | 'NO_INDEX'
  | 'SIZE_MISMATCH';

export type WarningCode =
  | 'EXTERNAL_SCRIPT'
  | 'EXTERNAL_STYLE'
  | 'EXTERNAL_RESOURCE'
  | 'EXTERNAL_FRAME'
  | 'EXTERNAL_FORM'
  | 'EXTERNAL_REQUEST'
  | 'INLINE_SCRIPT'
  | 'INLINE_HANDLER'
  | 'JAVASCRIPT_URL'
  | 'EVAL'
  | 'ROOT_ABSOLUTE_PATH'
  | 'CASE_MISMATCH'
  | 'MISSING_FILE';

export interface Issue<C extends string> {
  code: C;
  /** Path inside the archive, when the issue concerns one file. */
  file?: string;
  message: string;
}

const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
const ALLOWED_LIST = Object.keys(CONTENT_TYPES).join(', ');

export function errorMessage(
  code: ErrorCode,
  file: string | undefined,
  limits: UploadLimits,
  detail?: string,
): string {
  const f = file ? `"${file}"` : 'The archive';
  switch (code) {
    case 'NOT_A_ZIP':
      return 'This file is not a valid ZIP archive. Create the ZIP again (for example with "Compress" in Finder or "Send to > Compressed folder" in Windows) and upload it.';
    case 'ARCHIVE_TOO_LARGE':
      return `The ZIP file is larger than ${mb(limits.maxArchiveBytes)}. Remove large files such as videos or unused images, or compress images, and try again.`;
    case 'EMPTY_ARCHIVE':
      return 'The ZIP contains no files. Make sure you compressed the folder that contains your website.';
    case 'TOO_MANY_FILES':
      return `The ZIP contains more than ${limits.maxFiles} files. Remove files the website does not use (for example node_modules or source files) and try again.`;
    case 'FILE_TOO_LARGE':
      return `${f} is larger than ${mb(limits.maxFileBytes)}. Make it smaller (for example by compressing the image or shortening the video) or remove it.`;
    case 'TOTAL_TOO_LARGE':
      return `The files in the ZIP add up to more than ${mb(limits.maxTotalBytes)} when unpacked. Remove large or unused files and try again.`;
    case 'COMPRESSION_RATIO':
      return `The ZIP unpacks to more than ${limits.maxCompressionRatio} times its own size, which is typical of a "ZIP bomb". Create the ZIP again from your normal project folder.`;
    case 'ABSOLUTE_PATH':
      return `${f} has an absolute path (it starts with "/" or a drive letter such as "C:"). Create the ZIP by compressing your project folder, so that all paths are relative.`;
    case 'PARENT_PATH':
      return `${f} contains ".." in its path, which would place the file outside your website folder. Create the ZIP again by compressing your project folder.`;
    case 'BACKSLASH_PATH':
      return `${f} uses "\\" as a folder separator. Create the ZIP with your operating system's built-in compress feature, which uses "/".`;
    case 'INVALID_NAME':
      return `${f} has a file name that cannot be used (${detail ?? 'invalid name'}). Rename the file using letters, numbers, "-", "_" and "." only.`;
    case 'ENCODING':
      return `A file name in the ZIP uses an unsupported character encoding. Rename files with non-English characters, or create the ZIP with a tool that stores UTF-8 names.`;
    case 'SYMLINK':
      return `${f} is a symbolic link (shortcut). Links are not allowed; replace it with a copy of the real file.`;
    case 'SPECIAL_FILE':
      return `${f} is not a normal file or folder. Remove it from the ZIP.`;
    case 'FORBIDDEN_TYPE':
      return `${f} has a file type that is not allowed. Only static website files can be uploaded: ${ALLOWED_LIST}. Remove the file or convert it to an allowed type.`;
    case 'DUPLICATE_PATH':
      return `${f} appears more than once in the ZIP. Create the ZIP again so that each file appears once.`;
    case 'CASE_CONFLICT':
      return `${f} differs from another file only in upper/lower case (${detail ?? ''}). Rename one of them; such names break on many computers.`;
    case 'ENCRYPTED':
      return `${f} is password-protected. Create the ZIP again without a password.`;
    case 'NO_INDEX':
      return detail
        ? `There is no "index.html" at the top level of the ZIP. ${detail}`
        : 'There is no "index.html" at the top level of the ZIP. Your home page must be called index.html and be in the folder you compress.';
    case 'SIZE_MISMATCH':
      return `${f} is corrupted (its real size does not match the size recorded in the ZIP). Create the ZIP again.`;
  }
}

export function warningMessage(code: WarningCode, file: string, detail: string): string {
  const f = `"${file}"`;
  switch (code) {
    case 'EXTERNAL_SCRIPT':
      return `${f} loads a script from another website (${detail}). The security policy blocks it, so it will not run. Download the library into your project and load it with a relative path, e.g. <script src="js/library.js">.`;
    case 'EXTERNAL_STYLE':
      return `${f} loads a stylesheet from another website (${detail}). The security policy blocks it. Download the CSS (and any fonts it uses) into your project and link it with a relative path.`;
    case 'EXTERNAL_RESOURCE':
      return `${f} loads a file from another website (${detail}). The security policy blocks it. Copy the image, font or media file into your project and use a relative path.`;
    case 'EXTERNAL_FRAME':
      return `${f} embeds another website in a frame (${detail}). Embedded frames such as video players are blocked. Use a link or a local video file instead.`;
    case 'EXTERNAL_FORM':
      return `${f} has a form that sends data to another website (${detail}). Forms may only submit to pages of your own site. Handle the form in JavaScript or submit it to a page in your project.`;
    case 'EXTERNAL_REQUEST':
      return `${f} requests data from another website (${detail}). The security policy blocks it. Save the data as a .json file in your project and fetch it with a relative path.`;
    case 'INLINE_SCRIPT':
      return `${f} contains JavaScript inside a <script> tag. The security policy blocks inline scripts, so it will not run. Move the code into a .js file and load it with <script src="script.js"></script>.`;
    case 'INLINE_HANDLER':
      return `${f} uses an inline event attribute (${detail}). The security policy blocks it. Add the event listener in your .js file instead, e.g. element.addEventListener('click', ...).`;
    case 'JAVASCRIPT_URL':
      return `${f} uses a "javascript:" link (${detail}). It is blocked by the security policy. Use a button with an event listener in your .js file.`;
    case 'EVAL':
      return `${f} uses ${detail}, which the security policy blocks. Rewrite the code without eval() or new Function().`;
    case 'ROOT_ABSOLUTE_PATH':
      return `${f} links to "${detail}", which starts with "/". Such links do not work on Web Cove. Use a relative path instead, e.g. "${detail.replace(/^\/+/, '')}".`;
    case 'CASE_MISMATCH':
      return `${f} links to "${detail}". The file exists, but with different upper/lower case letters. Web servers treat these as different files; make the link match the file name exactly.`;
    case 'MISSING_FILE':
      return `${f} links to "${detail}", which is not in the ZIP. Add the missing file or correct the link.`;
  }
}
