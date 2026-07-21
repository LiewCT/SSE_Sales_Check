import {
  useEffect,
  useState
} from "react";

function PwaInstallButton() {
  const [
    installPrompt,
    setInstallPrompt
  ] = useState(null);

  const [
    isInstalled,
    setIsInstalled
  ] = useState(() => {
    const isStandalone =
      window.matchMedia(
        "(display-mode: standalone)"
      ).matches;

    const isIOSStandalone =
      window.navigator.standalone === true;

    return (
      isStandalone ||
      isIOSStandalone
    );
  });

  const [isIOS] = useState(() => {
    return /iphone|ipad|ipod/i.test(
      window.navigator.userAgent
    );
  });

  const [isSecure] = useState(() => {
    return (
      window.isSecureContext ||
      window.location.hostname ===
        "localhost"
    );
  });

  useEffect(() => {
    console.log(
      "PWA component loaded"
    );

    const handleBeforeInstallPrompt = (
      event
    ) => {
      console.log(
        "beforeinstallprompt fired"
      );

      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleAppInstalled = () => {
      console.log(
        "PWA installed"
      );

      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt
    );

    window.addEventListener(
      "appinstalled",
      handleAppInstalled
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );

      window.removeEventListener(
        "appinstalled",
        handleAppInstalled
      );
    };
  }, []);

  const installApplication =
    async () => {
      if (!installPrompt) {
        return;
      }

      try {
        await installPrompt.prompt();

        const result =
          await installPrompt.userChoice;

        console.log(
          "Install result:",
          result.outcome
        );

        if (
          result.outcome === "accepted"
        ) {
          setIsInstalled(true);
        }
      } catch (error) {
        console.error(
          "PWA installation failed",
          error
        );
      } finally {
        /*
          Each beforeinstallprompt event
          can only be used once.
        */
        setInstallPrompt(null);
      }
    };

  if (isInstalled) {
    return (
      <div className="pwa-installed">
        App Installed
      </div>
    );
  }

  if (!isSecure) {
    return (
      <div className="pwa-unavailable">
        HTTPS Required
      </div>
    );
  }

  if (isIOS) {
    return (
      <div className="pwa-ios-message">
        Use Share → Add to Home Screen
      </div>
    );
  }

  /*
    Display a disabled button while waiting.

    This helps confirm that the component
    has been imported correctly.
  */
  if (!installPrompt) {
    return (
      <button
        type="button"
        className="install-app-button unavailable"
        disabled
        title="The browser has not provided the install prompt yet."
      >
        Install Unavailable
      </button>
    );
  }

  return (
    <button
      type="button"
      className="install-app-button"
      onClick={installApplication}
    >
      Install App
    </button>
  );
}

export default PwaInstallButton;