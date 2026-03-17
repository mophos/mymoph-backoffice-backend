import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { MenuService } from './menu.service';

const router = Router();
const menuService = new MenuService();

router.get('/', authMiddleware, async (req, res) => {
  const auth = req.auth!;
  const menus = menuService.getMenusByPermissions(auth.permissions);

  res.json({
    ok: true,
    data: {
      allowedModules: menuService.getAllowedModules(auth.permissions),
      menus
    }
  });
});

export const menuRoutes = router;
