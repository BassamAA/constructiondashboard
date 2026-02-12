import { Link, useRouteError } from "react-router-dom";

export function NotFoundPage() {
  const error = useRouteError() as { statusText?: string; message?: string } | undefined;

  return (
    <section>
      <h2>Page not found</h2>
      {error?.statusText || error?.message ? (
        <p>{error.statusText ?? error.message}</p>
      ) : (
        <p>The page you were looking for does not exist.</p>
      )}
      <Link to="/">Go back home</Link>
    </section>
  );
}

export default NotFoundPage;
