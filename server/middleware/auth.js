import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const token = header.slice(7);
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

export function signToken(userId, email) {
    return jwt.sign({ id: userId, email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}
