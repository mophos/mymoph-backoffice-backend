import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { MenuService } from './menu.service';

const router = Router();
const menuService = new MenuService();

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const auth = req.auth!;
  const menus = menuService.getMenusByPermissions(auth.permissions, auth.roles);

  res.json({
    ok: true,
    data: {
      allowedModules: menuService.getAllowedModules(auth.permissions, auth.roles),
      menus
    }
  });
}));

export const menuRoutes = router;
