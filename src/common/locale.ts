import { type LocaleKeys, createLocale } from '@heritage-rp/lib/locale';

export default createLocale<LocaleKeys<typeof import('../../locales/en.json')>>();
