import React from 'react';
import { Link } from 'react-router-dom';
import Footer from '../components/Footer';
import Seo, { SITE_URL } from '../components/Seo';
import SiteImage from '../components/SiteImage';
import { useFullpageSections } from '../hooks/useFullpageSections';
import '../styles/fullpage.css';
import './Home.css';

const TOTAL_SECTIONS = 4;

const Home = () => {
    const { sectionStyle, handleTouchStart, handleTouchEnd, floatingLogoPortal } = useFullpageSections(TOTAL_SECTIONS);

    return (
        <>
        <Seo
            title="MORBEI | Minimalist Fashion"
            path="/"
            jsonLd={{
                '@context': 'https://schema.org',
                '@type': 'Organization',
                name: 'MORBEI',
                url: SITE_URL,
                logo: `${SITE_URL}/favicon.png`,
                description: 'Minimalist fashion crafted in India. Designed with restraint.',
                address: { '@type': 'PostalAddress', addressCountry: 'IN' },
            }}
        />
        {floatingLogoPortal}
        <div
            className="fp-page"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Section 0 — Hero */}
            <section className="fp-section fp-hero" style={{ ...sectionStyle(0), zIndex: 1 }}>
                <SiteImage
                    slot="home-hero"
                    fallback="/newhome/herosec.webp"
                    alt="Hero"
                    className="fp-hero-img"
                    width={1920}
                    widths={[800, 1200, 1600, 1920, 2400]}
                    // The hero is object-fit: cover in a 100vw x 100svh box, and
                    // the source is 16:9. On a portrait phone the box is far
                    // taller than it is wide, so cover scales the image by
                    // height and renders it about 1440 CSS px wide inside a
                    // 375px window — most of it cropped away off-screen.
                    //
                    // sizes describes the box, not the render, so "100vw" told
                    // the browser 375px and it chose the 800w file, which then
                    // got blown up 3.6x. The rendered width is really
                    // max(boxWidth, boxHeight x aspect), which is what this says
                    // — 16:9 makes the second term 177.8vh. Measured: the
                    // browser now picks 2400w where it used to pick 800w.
                    sizes="max(100vw, 178vh)"
                    priority
                />
                <div className="fp-hero-cta">
                    <Link to="/shop/all" className="fp-hero-shop-link">SHOP</Link>
                </div>
            </section>

            {/* Section 1 — Editorial */}
            <section className="fp-section fp-editorial" style={{ ...sectionStyle(1), zIndex: 2 }}>
                <div className="fp-editorial-split">
                    <div className="fp-editorial-half">
                        <SiteImage slot="home-editorial-left" fallback="/campaign-1.webp" alt="Campaign"
                            width={1200} widths={[600, 900, 1200]} sizes="50vw" />
                    </div>
                    <div className="fp-editorial-half">
                        <SiteImage slot="home-editorial-right" fallback="/split-right.webp" alt="Campaign"
                            width={1200} widths={[600, 900, 1200]} sizes="50vw" />
                    </div>
                </div>
                <div className="fp-editorial-overlay">
                    <h2 className="fp-editorial-title">PRE-FALL '26</h2>
                    <Link to="/shop/new-in" className="fp-editorial-link">EXPLORE</Link>
                </div>
            </section>

            {/* Section 2 — Dresses / Categories */}
            <section className="fp-section fp-categories" style={{ ...sectionStyle(2), zIndex: 3 }}>
                <div className="fp-categories-grid">
                    <Link to="/shop/dresses" className="fp-cat-item">
                        <div className="fp-cat-img"><SiteImage slot="home-category-dresses" fallback="/campaign-1.webp" alt="Dresses" width={800} widths={[400, 600, 800]} sizes="33vw" /></div>
                        <span className="fp-cat-label">DRESSES</span>
                    </Link>
                    <Link to="/shop/tops" className="fp-cat-item">
                        <div className="fp-cat-img"><SiteImage slot="home-category-tops" fallback="/campaign-2.webp" alt="Tops" width={800} widths={[400, 600, 800]} sizes="33vw" /></div>
                        <span className="fp-cat-label">TOPS</span>
                    </Link>
                    <Link to="/shop/bottoms" className="fp-cat-item">
                        <div className="fp-cat-img"><SiteImage slot="home-category-bottoms" fallback="/edit5.webp" alt="Bottoms" width={800} widths={[400, 600, 800]} sizes="33vw" /></div>
                        <span className="fp-cat-label">BOTTOMS</span>
                    </Link>
                </div>
            </section>

            {/* Section 3 — Footer */}
            <section className="fp-section fp-footer-section" style={{ ...sectionStyle(3), zIndex: 4 }}>
                <Footer showWordmark />
            </section>
        </div>
        </>
    );
};

export default Home;

