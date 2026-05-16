import { AppShell } from './components/AppShell';
import { I18nProvider } from './i18n/I18nContext';

export default function App() {
  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
}
