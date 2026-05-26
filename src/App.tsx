import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n/I18nContext';

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </ErrorBoundary>
  );
}
