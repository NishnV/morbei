import React from 'react';
import './About.css';

const About = () => {
    return (
        <div className="about-page">
            <section className="about-hero reveal reveal-up">
                <div className="container">
                    <h1 className="serif">Our Ethos</h1>
                    <p className="lead">Morbei is founded on the principles of timeless design, ethical craftsmanship, and minimalist luxury.</p>
                </div>
            </section>

            <section className="about-content container">
                <div className="grid-2">
                    <div className="about-text reveal reveal-right">
                        <h2>The Vision</h2>
                        <p>At Morbei, we believe that the clothes we wear should be an extension of our inner selves—simple, elegant, and intentional. We reject the fast-fashion cycle in favor of pieces that endure, both in quality and style.</p>
                        <p>Every collection is a study in form and fabric, designed for the modern individual who values substance as much as style.</p>
                    </div>
                    <div className="about-image reveal reveal-left">
                        <img src="https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=1200&q=80" alt="Studio" />
                    </div>
                </div>
            </section>

            <section className="values container">
                <div className="grid-3">
                    <div className="value-item reveal reveal-up reveal-delay-1">
                        <h3>Quality</h3>
                        <p>Sourcing the finest fabrics from heritage mills to ensure longevity.</p>
                    </div>
                    <div className="value-item reveal reveal-up reveal-delay-2">
                        <h3>Sustainability</h3>
                        <p>Committing to ethical production and minimal waste practices.</p>
                    </div>
                    <div className="value-item reveal reveal-up reveal-delay-3">
                        <h3>Design</h3>
                        <p>Creating architectural silhouettes that celebrate the human form.</p>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default About;
