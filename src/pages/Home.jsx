import React, { useState, useLayoutEffect, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Footer from '../components/Footer';
import './Home.css';

const TOTAL_SECTIONS = 4;
const TRANSITION_MS = 900;
// svh matches .fp-section height: the small viewport (browser UI expanded). This
// page never scrolls, so on iPad the browser bar never collapses — vh/dvh would
// include the strip hidden behind it.
const SVH_SUPPORTED = typeof CSS !== 'undefined' && CSS.supports('height', '100svh');
const LOGO_EASING = 'cubic-bezier(0.76, 0, 0.24, 1)';

// Floating logo intrinsic size — rendered LARGE so Safari rasterizes at high resolution.
// The element is scaled down in the start keyframe to visually match the 40px navbar logo.
// Safari pixelates when scaling a small bitmap up; rendering large and scaling down stays sharp.
const NAV_LOGO_H = 40;          // visual size at navbar position (px)
// Use larger SVG on mobile for better visibility during animation
const getSvgHeight = () => window.innerWidth <= 768 ? 600 : 400;
const SVG_H = 400;              // actual CSS render height (will be overridden by getSvgHeight)
const SVG_W = SVG_H * (871.75 / 250.29);
const SVG_TOP = 4;              // .fp-floating-logo top: 4px
// Start keyframe: scale + translate to make element look like the navbar logo
const START_SCALE = NAV_LOGO_H / SVG_H;                              // 0.1
const START_TY    = (SVG_TOP + NAV_LOGO_H / 2) - (SVG_TOP + SVG_H / 2); // 24 - 204 = -180px

const Home = () => {
    const [activeSection, setActiveSection] = useState(0);
    const prevSectionRef = useRef(0);
    const activeSectionRef = useRef(0);
    const isTransitioning = useRef(false);
    const touchStartY = useRef(0);

    const floatingLogoRef = useRef(null);
    const logoAnimRef = useRef(null);

    // Lock body scroll while on home page
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // Build the CSS transform that maps the floating logo onto the footer wordmark.
    // The floating logo SVG has viewBox "0 0 871.75 250.29": letters occupy y=50–200.
    // The wordmark SVG has viewBox "0 50 871.75 150": the element IS the letter region.
    // We need the letter-region center of the floating logo to land on the wordmark center.
    const buildEndTransform = (wordmarkRect) => {
        const svgH = getSvgHeight();
        const svgW = svgH * (871.75 / 250.29);
        // Floating logo: letter region within full viewBox
        const letterH   = svgH * (150 / 250.29);
        const letterTop = SVG_TOP + svgH * (50 / 250.29);
        const letterCY  = letterTop + letterH / 2;
        // When SVG is wider than viewport, margin:auto can't center it — browser anchors left:0
        const elementLeft = svgW > window.innerWidth ? 0 : (window.innerWidth - svgW) / 2;
        const letterCX = elementLeft + svgW / 2;

        // Footer wordmark center
        const wCX = wordmarkRect.left + wordmarkRect.width  / 2;
        const wCY = wordmarkRect.top  + wordmarkRect.height / 2;

        // Uniform scale: make letter height match wordmark height
        const scale = wordmarkRect.height / letterH;

        return { tx: wCX - letterCX, ty: wCY - letterCY, scale };
    };

    // Build the start transform to place the floating logo over the visible navbar logo.
    // On desktop the logo is .nav-center (centered); on mobile it is .mobile-navbar-logo (left side).
    const buildStartTransform = () => {
        const svgH = getSvgHeight();
        const svgW = svgH * (871.75 / 250.29);
        const letterH  = svgH * (150 / 250.29);
        const letterCY = SVG_TOP + svgH * (50 / 250.29) + letterH / 2;
        // When SVG is wider than viewport, margin:auto can't center it — browser anchors left:0
        const elementLeft = svgW > window.innerWidth ? 0 : (window.innerWidth - svgW) / 2;
        const floatCX = elementLeft + svgW / 2;

        // Find the visible navbar logo SVG element
        let navSvg = null;
        if (window.innerWidth <= 768) {
            // Mobile: look in .mobile-navbar-logo
            navSvg = document.querySelector('.mobile-navbar-logo svg');
        } else {
            // Desktop: look in .nav-center
            navSvg = document.querySelector('.nav-center svg');
        }

        if (navSvg) {
            const r = navSvg.getBoundingClientRect();
            const nCX = r.left + r.width  / 2;
            const nCY = r.top  + r.height / 2;
            // Scale the SVG to match the navbar logo's rendered height
            const scale = r.height / svgH;
            return { tx: nCX - floatCX, ty: nCY - letterCY, scale };
        }

        // Fallback: desktop-style center start
        const startScale = NAV_LOGO_H / svgH;
        const startTy = (SVG_TOP + NAV_LOGO_H / 2) - (SVG_TOP + svgH / 2);
        return { tx: 0, ty: startTy, scale: startScale };
    };

    // ── Animation trigger ─────────────────────────────────────────────────────
    // useLayoutEffect fires synchronously after React's DOM commit, BEFORE the
    // browser paints. This means the WAAPI animation and the CSS section transition
    // both start on the exact same paint frame — they are perfectly in sync.
    useLayoutEffect(() => {
        const prev = prevSectionRef.current;
        prevSectionRef.current = activeSection;
        activeSectionRef.current = activeSection;

        const floatingEl = floatingLogoRef.current;
        if (!floatingEl) return;

        // Cancel any in-flight animation before starting a new one
        if (logoAnimRef.current) {
            logoAnimRef.current.cancel();
            logoAnimRef.current = null;
        }

        // Measure the wordmark RELATIVE to its section. The section settles at
        // (0,0), so (wordmarkRect − sectionRect) IS the settled viewport position —
        // valid whether the section is off-screen, mid-transition, or settled.
        // This avoids correcting by window.innerHeight, which goes stale on mobile
        // when the browser address bar collapses/expands between swipes.
        const measureWordmark = () => {
            const sectionEl = document.querySelector('.fp-footer-section');
            const el = sectionEl && sectionEl.querySelector('.footer-wordmark-svg');
            if (!el) return null;
            const sRect = sectionEl.getBoundingClientRect();
            const raw = el.getBoundingClientRect();
            return {
                top:    raw.top  - sRect.top,
                left:   raw.left - sRect.left,
                width:  raw.width,
                height: raw.height,
            };
        };

        if (activeSection === 3 && prev !== 3) {
            // ── Entering footer section ──
            if (!measureWordmark()) return;
            const start = buildStartTransform();

            document.body.classList.add('fp-nav-logo-hidden');
            document.body.classList.add('fp-wordmark-hidden');
            floatingEl.style.visibility = 'visible';
            floatingEl.style.display = 'block';
            floatingEl.style.opacity = '1';
            // Set initial transform explicitly to force paint before animation
            floatingEl.style.transform = `translate(${start.tx}px,${start.ty}px) scale(${start.scale})`;

            // Detect mobile for extra delay (DevTools mobile emulator needs this)
            const isMobile = window.innerWidth <= 768;
            const startDelay = isMobile ? 50 : 0;

            setTimeout(() => {
                // Double RAF on mobile to ensure compositor is ready (critical for mobile)
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Re-measure here (fresh viewport state) — relative measurement
                        // stays correct even though the section is mid-transition now.
                        const wRect = measureWordmark();
                        if (!wRect) return;
                        const end = buildEndTransform(wRect);
                        // Calculate intermediate keyframes for smoother mobile animation
                        const midTx = start.tx + (end.tx - start.tx) * 0.5;
                        const midTy = start.ty + (end.ty - start.ty) * 0.5;
                        const midScale = start.scale + (end.scale - start.scale) * 0.5;

                        const anim = floatingEl.animate(
                            [
                                { transform: `translate(${start.tx}px,${start.ty}px) scale(${start.scale})`,   opacity: 1, offset: 0    },
                                { transform: `translate(${start.tx}px,${start.ty}px) scale(${start.scale})`,   opacity: 1, offset: 0.05 },
                                { transform: `translate(${midTx}px,${midTy}px) scale(${midScale})`,            opacity: 1, offset: 0.5  },
                                { transform: `translate(${end.tx}px,${end.ty}px) scale(${end.scale})`,          opacity: 1, offset: 1    },
                            ],
                            { duration: TRANSITION_MS, easing: LOGO_EASING, fill: 'forwards' }
                        );
                        logoAnimRef.current = anim;

                        anim.onfinish = () => {
                            // Logo has arrived — hide it, reveal the real wordmark underneath.
                            // Keep logoAnimRef alive so the next trigger can cancel the fill:forwards.
                            floatingEl.style.visibility = 'hidden';
                            floatingEl.style.transform = '';
                            floatingEl.style.opacity = '';
                            document.body.classList.remove('fp-wordmark-hidden');
                        };
                    });
                });
            }, startDelay);

        } else if (activeSection !== 3 && prev === 3) {
            // ── Leaving footer section ──
            const wRect = measureWordmark();
            if (!wRect) {
                document.body.classList.remove('fp-nav-logo-hidden');
                document.body.classList.remove('fp-wordmark-hidden');
                return;
            }
            const end = buildEndTransform(wRect);
            const start = buildStartTransform();

            // Wordmark sliding away — hide it, show floating logo at wordmark position
            document.body.classList.add('fp-nav-logo-hidden');
            document.body.classList.add('fp-wordmark-hidden');
            floatingEl.style.visibility = 'visible';
            floatingEl.style.display = 'block';
            // Set initial transform explicitly to force paint before animation
            floatingEl.style.transform = `translate(${end.tx}px,${end.ty}px) scale(${end.scale})`;
            floatingEl.style.opacity = '1';

            // Detect mobile for extra delay (DevTools mobile emulator needs this)
            const isMobile = window.innerWidth <= 768;
            const startDelay = isMobile ? 50 : 0;

            setTimeout(() => {
                // Double RAF on mobile to ensure compositor is ready (critical for mobile)
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Calculate intermediate keyframes for smoother mobile animation
                        const midTx = end.tx + (start.tx - end.tx) * 0.5;
                        const midTy = end.ty + (start.ty - end.ty) * 0.5;
                        const midScale = end.scale + (start.scale - end.scale) * 0.5;

                        const anim = floatingEl.animate(
                            [
                                { transform: `translate(${end.tx}px,${end.ty}px) scale(${end.scale})`,          opacity: 1, offset: 0    },
                                { transform: `translate(${midTx}px,${midTy}px) scale(${midScale})`,            opacity: 1, offset: 0.5  },
                                { transform: `translate(${start.tx}px,${start.ty}px) scale(${start.scale})`,   opacity: 1, offset: 0.94 },
                                { transform: `translate(${start.tx}px,${start.ty}px) scale(${start.scale})`,   opacity: 0, offset: 1    },
                            ],
                            { duration: TRANSITION_MS, easing: LOGO_EASING, fill: 'forwards' }
                        );
                        logoAnimRef.current = anim;

                        anim.onfinish = () => {
                            // Keep logoAnimRef alive so the next trigger can cancel the fill:forwards.
                            floatingEl.style.visibility = 'hidden';
                            floatingEl.style.transform = '';
                            floatingEl.style.opacity = '';
                            document.body.classList.remove('fp-nav-logo-hidden');
                            document.body.classList.remove('fp-wordmark-hidden');
                        };
                    });
                });
            }, startDelay);

        } else if (prev !== activeSection) {
            // Non-footer transition — ensure clean state
            floatingEl.style.visibility = 'hidden';
            document.body.classList.remove('fp-nav-logo-hidden');
            document.body.classList.remove('fp-wordmark-hidden');
        }
    }, [activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (logoAnimRef.current) logoAnimRef.current.cancel();
            document.body.classList.remove('fp-nav-logo-hidden');
            document.body.classList.remove('fp-wordmark-hidden');
        };
    }, []);
    const goToSection = useCallback((idx) => {
        if (isTransitioning.current || idx < 0 || idx >= TOTAL_SECTIONS) return;
        isTransitioning.current = true;
        setActiveSection(idx);
        setTimeout(() => { isTransitioning.current = false; }, TRANSITION_MS);
    }, []);

    const goNext = useCallback(() => setActiveSection(prev => {
        if (isTransitioning.current || prev >= TOTAL_SECTIONS - 1) return prev;
        isTransitioning.current = true;
        setTimeout(() => { isTransitioning.current = false; }, TRANSITION_MS);
        return prev + 1;
    }), []);

    const goPrev = useCallback(() => setActiveSection(prev => {
        if (isTransitioning.current || prev <= 0) return prev;
        isTransitioning.current = true;
        setTimeout(() => { isTransitioning.current = false; }, TRANSITION_MS);
        return prev - 1;
    }), []);

    // Wheel + keyboard events
    useEffect(() => {
        const handleWheel = (e) => {
            e.preventDefault();
            if (e.deltaY > 30) goNext();
            else if (e.deltaY < -30) goPrev();
        };
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowDown' || e.key === 'PageDown') goNext();
            if (e.key === 'ArrowUp' || e.key === 'PageUp') goPrev();
        };
        window.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [goNext, goPrev]);

    const handleTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
    const handleTouchEnd = (e) => {
        const diff = touchStartY.current - e.changedTouches[0].clientY;
        if (Math.abs(diff) > 50) { if (diff > 0) goNext(); else goPrev(); }
    };

    // Off-screen sections park exactly one section-height (100svh) below, matching
    // .fp-section height in CSS. The logo animation measures the wordmark relative
    // to its section, so it doesn't need this value to match window.innerHeight.
    const sectionStyle = (idx) => ({
        transform: idx <= activeSection
            ? 'translateY(0)'
            : `translateY(${SVH_SUPPORTED ? '100svh' : `${window.innerHeight}px`})`,
    });

    const floatingLogoEl = (
        <Link
            to="/"
            className="fp-floating-logo"
            ref={floatingLogoRef}
            aria-label="MORBEI home"
        >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 871.75 250.29" fill="white" aria-label="MORBEI" className="fp-logo-svg">
                    <path d="M0,196.75h3.56c10.74,0,14.72-3.92,14.72-14.5v-117.88c0-7.75-1.05-10.83-11.63-10.83H0v-1.84h32.76c22.47,39.02,44.95,78.04,67.42,117.06,2.31,4.01,3.56,7.56,3.56,8.78h1.19c0-1.22,1.6-5.75,3.32-8.78,22.08-39.02,44.16-78.04,66.24-117.06h35.37v1.84h-7.12c-12.37,0-13.06,4.6-13.06,14.51v114.2c0,10.59,4.1,14.5,15.19,14.5h5.22v1.84h-61.96v-1.84h8.55c10.57,0,14.48-3.36,14.48-12.46v-106.64c0-3.27,0-6.74.24-8.99h-1.66c-.24.61-1.9,4.09-4.04,8.38-22.87,40.79-45.74,81.58-68.61,122.37-.29.57-.43.86-.71,1.43h-.47c-.29-.57-.43-.86-.71-1.43-22.95-40.04-45.9-80.08-68.85-120.12-2.14-4.09-3.09-7.97-3.09-8.58h-.95c.24,1.84.24,3.32.24,6.95v106.64c0,9.1,3.97,12.46,14.72,12.46h8.55v1.84H0v-1.84Z"/>
                    <path d="M215.8,125.04c.07-45.91,46.11-74.93,88.08-74.97,44.69-.04,87.68,26.31,87.61,74.97-.07,45.82-45.56,75.14-87.61,75.18-44.82.04-88.16-26.29-88.08-75.18ZM370.83,128.92c-.06-37.63-28.1-75.1-67.9-75.18-38.81-.07-66.53,29.17-66.47,67.62.06,37.74,28.29,75.1,68.14,75.18,38.79.07,66.3-29.29,66.24-67.62Z"/>
                    <path d="M399.55,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h61.96c26.56.22,63.73,12.88,63.15,45.35-.47,26.25-26.65,41.84-50.33,44.13-1.9.08-2.85.12-4.75.2v1.23c9.33.55,20.83,6.4,26.35,14.1,4.75,6.46,7.12,9.68,11.87,16.14,5.68,8.02,13.7,20.09,23.24,21.01,1.98.19,4.47-.73,6.79-2.44,2.09-1.55,3.13-2.33,5.22-3.88.52.58.78.87,1.3,1.46-2.09,1.55-3.13,2.33-5.22,3.88-7.57,5.61-14.11,7.97-19.6,7.86-12.32-.25-21.23-11.06-27.88-20.53-6.65-8.83-9.97-13.24-16.62-22.06-5.51-8.09-12.91-16.03-23.5-15.73h-2.85v-3.47h10.92c23.12,0,44.4-18.07,44.4-41.88,0-23.78-21.36-41.68-44.4-41.68h-24.69v.2c2.85,2.45,4.04,5.92,4.04,10.62v119.71c0,9.81,1.42,10.83,12.82,10.83h13.77v1.84h-66v-1.84Z"/>
                    <path d="M542.23,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h57.93c19.68.08,56.31,5.77,56.27,30.85-.03,15.93-19.36,27.51-34.19,28.6v.82c23.55,1.39,52.37,18.25,52.23,44.13-.17,31.53-39.57,42.25-65.52,42.49h-66.71v-1.84ZM604.67,194.91c23.69-.16,48.47-12.56,49.14-38.82.69-26.97-26.76-41.87-50.57-42.08h-12.58v-3.47h9.5c16.21.68,36.03-9.27,36.09-27.58.06-20.29-22.77-27.76-39.41-27.58h-19.23v.2c2.85,2.45,4.04,5.92,4.04,10.62v117.88c0,4.7-1.19,7.97-4.04,10.42v.41h27.07Z"/>
                    <path d="M682.54,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h94.73c3.8,0,7.12.41,8.78,1.84h.24c-.28-3.79-.42-5.69-.71-9.48.85-.05,1.28-.07,2.13-.12,1.42,18.45,2.85,36.91,4.27,55.36h-4.27c-.38-5.72-.57-8.58-.95-14.3-.77-21.48-16.8-30.04-36.56-29.62h-33.47v.2c2.85,2.45,5.22,6.13,5.22,10.62v53.52h9.5c14.05.21,26.52-5.13,25.64-21.66v-7.15h2.14v65.58h-2.14v-11.24c.86-16.49-11.54-22.05-25.64-21.86h-9.5v60.67c0,4.49-2.37,8.17-5.22,10.62v.2h47.24c18.59.4,34.2-7.38,35.37-27.58.57-6.54.85-9.81,1.42-16.34h3.8c-1.34,18.45-2.69,36.91-4.04,55.36-.85-.05-1.28-.07-2.13-.11.28-3.8.42-5.69.71-9.49h-.24c-1.66,1.43-4.99,1.84-8.78,1.84h-107.55v-1.84Z"/>
                    <path d="M811.21,196.75h8.31c11.4,0,12.58-.82,12.58-10.62v-121.96c0-9.81-1.19-10.62-12.58-10.62h-8.31v-1.84h60.54v2.25h-8.31c-11.4,0-12.82.82-12.82,10.62v121.55c0,9.81,1.42,10.62,12.82,10.62h8.31v1.84h-60.54v-1.84Z"/>
                </svg>
        </Link>
    );

    return (
        <>
        {createPortal(floatingLogoEl, document.body)}
        <div
            className="home-fullpage"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Section 0 — Hero */}
            <section className="fp-section fp-hero" style={{ ...sectionStyle(0), zIndex: 1 }}>
                <img src="/newhome/herosec.webp" alt="Hero" className="fp-hero-img" />
                <div className="fp-hero-cta">
                    <Link to="/shop/all" className="fp-hero-shop-link">SHOP</Link>
                </div>
            </section>

            {/* Section 1 — Editorial */}
            <section className="fp-section fp-editorial" style={{ ...sectionStyle(1), zIndex: 2 }}>
                <div className="fp-editorial-split">
                    <div className="fp-editorial-half">
                        <img loading="lazy" src="/campaign-1.webp" alt="Campaign" />
                    </div>
                    <div className="fp-editorial-half">
                        <img loading="lazy" src="/split-right.webp" alt="Campaign" />
                    </div>
                </div>
                <div className="fp-editorial-overlay">
                    <h2 className="fp-editorial-title">S/S '26</h2>
                    <Link to="/shop/new-in" className="fp-editorial-link">EXPLORE</Link>
                </div>
            </section>

            {/* Section 2 — Dresses / Categories */}
            <section className="fp-section fp-categories" style={{ ...sectionStyle(2), zIndex: 3 }}>
                <div className="fp-categories-grid">
                    <Link to="/shop/dresses" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/campaign-1.webp" alt="Dresses" /></div>
                        <span className="fp-cat-label">DRESSES</span>
                    </Link>
                    <Link to="/shop/tops" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/campaign-2.webp" alt="Tops" /></div>
                        <span className="fp-cat-label">TOPS</span>
                    </Link>
                    <Link to="/shop/bottoms" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/edit5.webp" alt="Bottoms" /></div>
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

