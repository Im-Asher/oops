export default function LandingPage() {
  return (
    <div className="landing-root min-h-screen bg-white">
      <header data-landing-section="nav" />
      <main>
        <section data-landing-section="hero" />
        <section data-landing-section="slice" />
        <section data-landing-section="agents" />
        <section data-landing-section="how" />
        <section data-landing-section="compare" />
        <section data-landing-section="faq" />
        <section data-landing-section="closing" />
      </main>
      <footer data-landing-section="footer" />
    </div>
  );
}
