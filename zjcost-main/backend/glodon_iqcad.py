"""
广联达IQcad睿图API封装类
实现完整的图纸识别引擎接入
"""
import asyncio
import base64
import json
import logging
import time
from typing import Dict, Optional, Any, List
from urllib.parse import quote

import aiohttp
import requests
from aiohttp import ClientTimeout
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GlodonAPIError(Exception):
    """广联达API异常基类"""
    pass


class GlodonAuthError(GlodonAPIError):
    """认证异常"""
    pass


class GlodonUploadError(GlodonAPIError):
    """上传异常"""
    pass


class GlodonTimeoutError(GlodonAPIError):
    """超时异常"""
    pass


class GlodonIQcadClient:
    """
    广联达IQcad睿图API客户端
    实现完整的8步调用流程
    """
    
    # API端点配置
    TOKEN_URL = "https://account.glodon.com/oauth2/token"
    UPLOAD_URL = "https://apigate.glodon.com/bimface/file/upload"
    UPLOAD_STATUS_URL = "https://apigate.glodon.com/bimface/file/files/{file_id}/uploadstatus"
    TRANSLATE_URL = "https://apigate.glodon.com/bimface/api/translate"
    TRANSLATE_STATUS_URL = "https://apigate.glodon.com/bimface/api/translate"
    ANALYSIS_URL = "https://apigate.glodon.com/bimface/api/files/{file_id}/extractFeatures"
    ANALYSIS_STATUS_URL = "https://apigate.glodon.com/bimface/api/files/{file_id}/extractFeatures"
    RESULT_URL = "https://apigate.glodon.com/bimface/api/data/v2/files/{file_id}/drawingFeatures"
    
    def __init__(self, appkey: str, appsecret: str, timeout: int = 300):
        """
        初始化客户端
        
        Args:
            appkey: 应用密钥
            appsecret: 应用密钥
            timeout: 超时时间（秒）
        """
        self.appkey = appkey
        self.appsecret = appsecret
        self.timeout = timeout
        self.access_token: Optional[str] = None
        self.token_expire_time: float = 0
        self.session = None
        
    def _get_auth_header(self) -> str:
        """生成Basic认证头"""
        creds = f"{self.appkey}:{self.appsecret}"
        credential = base64.b64encode(creds.encode("UTF-8")).decode("UTF-8")
        return f"Basic {credential}"
    
    def _get_bearer_header(self) -> Dict[str, str]:
        """生成Bearer认证头"""
        if not self.access_token:
            raise GlodonAuthError("Access token not available, please call get_token first")
        return {"Authorization": f"Bearer {self.access_token}"}
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def get_token(self) -> str:
        """
        步骤1: 获取访问令牌
        
        Returns:
            access_token: 访问令牌
            
        Raises:
            GlodonAuthError: 认证失败
        """
        logger.info("正在获取广联达API访问令牌...")
        
        headers = {
            "Authorization": self._get_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        data = {
            "grant_type": "client_credentials"
        }
        
        try:
            response = requests.post(
                self.TOKEN_URL,
                headers=headers,
                data=data,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            
            if "access_token" not in result:
                raise GlodonAuthError(f"获取令牌失败: {result}")
            
            self.access_token = result["access_token"]
            # 设置过期时间，默认提前5分钟刷新
            expires_in = result.get("expires_in", 7200)
            self.token_expire_time = time.time() + expires_in - 300
            
            logger.info(f"获取令牌成功，有效期: {expires_in}秒")
            return self.access_token
            
        except requests.RequestException as e:
            logger.error(f"获取令牌请求失败: {e}")
            raise GlodonAuthError(f"获取令牌失败: {e}")
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def upload_dwg(self, file_path: str, file_name: Optional[str] = None) -> str:
        """
        步骤2: 上传DWG文件
        
        Args:
            file_path: DWG文件路径
            file_name: 文件名（可选，默认使用文件名）
            
        Returns:
            file_id: 文件ID
            
        Raises:
            GlodonUploadError: 上传失败
        """
        if not self.access_token or time.time() > self.token_expire_time:
            self.get_token()
            
        if not file_name:
            import os
            file_name = os.path.basename(file_path)
            
        logger.info(f"正在上传DWG文件: {file_name}")
        
        url = f"{self.UPLOAD_URL}?name={quote(file_name)}"
        
        try:
            with open(file_path, "rb") as f:
                response = requests.put(
                    url,
                    headers=self._get_bearer_header(),
                    data=f,
                    timeout=300
                )
            
            response.raise_for_status()
            result = response.json()
            
            if "fileId" not in result:
                raise GlodonUploadError(f"上传失败: {result}")
            
            file_id = result["fileId"]
            logger.info(f"文件上传成功，fileId: {file_id}")
            return file_id
            
        except requests.RequestException as e:
            logger.error(f"上传文件请求失败: {e}")
            raise GlodonUploadError(f"上传文件失败: {e}")
        except IOError as e:
            logger.error(f"读取文件失败: {e}")
            raise GlodonUploadError(f"读取文件失败: {e}")
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def query_upload_status(self, file_id: str) -> Dict[str, Any]:
        """
        步骤3: 查询上传状态
        
        Args:
            file_id: 文件ID
            
        Returns:
            上传状态信息
        """
        logger.info(f"查询上传状态，fileId: {file_id}")
        
        url = self.UPLOAD_STATUS_URL.format(file_id=file_id)
        
        try:
            response = requests.get(
                url,
                headers=self._get_bearer_header(),
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"上传状态: {result.get('status', 'unknown')}")
            return result
            
        except requests.RequestException as e:
            logger.error(f"查询上传状态失败: {e}")
            raise GlodonAPIError(f"查询上传状态失败: {e}")
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def start_conversion(self, file_id: str, compressed: bool = False) -> Dict[str, Any]:
        """
        步骤4: 发起图纸转换
        
        Args:
            file_id: 文件ID
            compressed: 是否压缩
            
        Returns:
            转换任务信息
        """
        logger.info(f"发起图纸转换，fileId: {file_id}")
        
        request_body = json.dumps({
            "source": {
                "fileId": file_id,
                "compressed": compressed
            }
        })
        
        headers = self._get_bearer_header()
        headers["Content-Type"] = "application/json"
        
        try:
            response = requests.put(
                self.TRANSLATE_URL,
                headers=headers,
                data=request_body,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"转换任务已发起: {result}")
            return result
            
        except requests.RequestException as e:
            logger.error(f"发起转换失败: {e}")
            raise GlodonAPIError(f"发起转换失败: {e}")
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def query_conversion_status(self, file_id: str) -> Dict[str, Any]:
        """
        步骤5: 查询转换状态
        
        Args:
            file_id: 文件ID
            
        Returns:
            转换状态信息
        """
        logger.info(f"查询转换状态，fileId: {file_id}")
        
        url = f"{self.TRANSLATE_STATUS_URL}?fileId={file_id}"
        
        try:
            response = requests.get(
                url,
                headers=self._get_bearer_header(),
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"转换状态: {result.get('status', 'unknown')}")
            return result
            
        except requests.RequestException as e:
            logger.error(f"查询转换状态失败: {e}")
            raise GlodonAPIError(f"查询转换状态失败: {e}")
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def start_analysis(self, file_id: str, features: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        步骤6: 发起结构化解析
        
        Args:
            file_id: 文件ID
            features: 解析特性列表，默认包含sheetFrame, floorTable
            
        Returns:
            解析任务信息
        """
        if features is None:
            features = ["sheetFrame", "floorTable"]
            
        logger.info(f"发起结构化解析，fileId: {file_id}, features: {features}")
        
        url = self.ANALYSIS_URL.format(file_id=file_id)
        
        request_body = json.dumps({
            "config": {
                "features": features
            }
        })
        
        headers = self._get_bearer_header()
        headers["Content-Type"] = "application/json"
        
        try:
            response = requests.put(
                url,
                headers=headers,
                data=request_body,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"解析任务已发起: {result}")
            return result
            
        except requests.RequestException as e:
            logger.error(f"发起解析失败: {e}")
            raise GlodonAPIError(f"发起解析失败: {e}")
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def query_analysis_status(self, file_id: str) -> Dict[str, Any]:
        """
        步骤7: 查询解析状态
        
        Args:
            file_id: 文件ID
            
        Returns:
            解析状态信息
        """
        logger.info(f"查询解析状态，fileId: {file_id}")
        
        url = self.ANALYSIS_STATUS_URL.format(file_id=file_id)
        
        try:
            response = requests.get(
                url,
                headers=self._get_bearer_header(),
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"解析状态: {result.get('status', 'unknown')}")
            return result
            
        except requests.RequestException as e:
            logger.error(f"查询解析状态失败: {e}")
            raise GlodonAPIError(f"查询解析状态失败: {e}")
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((requests.RequestException, GlodonAPIError))
    )
    def get_analysis_result(self, file_id: str) -> Dict[str, Any]:
        """
        步骤8: 获取解析结果
        
        Args:
            file_id: 文件ID
            
        Returns:
            结构化解析结果
        """
        logger.info(f"获取解析结果，fileId: {file_id}")
        
        url = self.RESULT_URL.format(file_id=file_id)
        
        try:
            response = requests.get(
                url,
                headers=self._get_bearer_header(),
                timeout=60
            )
            response.raise_for_status()
            result = response.json()
            logger.info(f"获取解析结果成功")
            return result
            
        except requests.RequestException as e:
            logger.error(f"获取解析结果失败: {e}")
            raise GlodonAPIError(f"获取解析结果失败: {e}")
    
    def wait_for_upload_complete(self, file_id: str, 
                                 poll_interval: int = 3, 
                                 max_wait: int = 300) -> bool:
        """
        等待上传完成
        
        Args:
            file_id: 文件ID
            poll_interval: 轮询间隔（秒）
            max_wait: 最大等待时间（秒）
            
        Returns:
            是否成功
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            status = self.query_upload_status(file_id)
            status_code = status.get("status")
            
            if status_code == "success":
                logger.info("上传完成")
                return True
            elif status_code == "failed":
                raise GlodonUploadError(f"上传失败: {status}")
            
            time.sleep(poll_interval)
        
        raise GlodonTimeoutError(f"等待上传超时，已等待{max_wait}秒")
    
    def wait_for_conversion_complete(self, file_id: str,
                                     poll_interval: int = 5,
                                     max_wait: int = 600) -> bool:
        """
        等待转换完成
        
        Args:
            file_id: 文件ID
            poll_interval: 轮询间隔（秒）
            max_wait: 最大等待时间（秒）
            
        Returns:
            是否成功
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            status = self.query_conversion_status(file_id)
            status_code = status.get("status")
            
            if status_code == "success":
                logger.info("转换完成")
                return True
            elif status_code == "failed":
                raise GlodonAPIError(f"转换失败: {status}")
            
            time.sleep(poll_interval)
        
        raise GlodonTimeoutError(f"等待转换超时，已等待{max_wait}秒")
    
    def wait_for_analysis_complete(self, file_id: str,
                                   poll_interval: int = 5,
                                   max_wait: int = 600) -> bool:
        """
        等待解析完成
        
        Args:
            file_id: 文件ID
            poll_interval: 轮询间隔（秒）
            max_wait: 最大等待时间（秒）
            
        Returns:
            是否成功
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            status = self.query_analysis_status(file_id)
            status_code = status.get("status")
            
            if status_code == "success":
                logger.info("解析完成")
                return True
            elif status_code == "failed":
                raise GlodonAPIError(f"解析失败: {status}")
            
            time.sleep(poll_interval)
        
        raise GlodonTimeoutError(f"等待解析超时，已等待{max_wait}秒")
    
    def recognize_drawing(self, file_path: str, 
                          file_name: Optional[str] = None,
                          progress_callback=None) -> Dict[str, Any]:
        """
        完整的图纸识别流程（同步）
        
        Args:
            file_path: DWG文件路径
            file_name: 文件名
            progress_callback: 进度回调函数
            
        Returns:
            完整的解析结果
        """
        logger.info("开始完整图纸识别流程...")
        
        # 步骤1: 获取token
        if progress_callback:
            progress_callback("authenticating", 0, "正在获取认证令牌")
        self.get_token()
        
        # 步骤2: 上传文件
        if progress_callback:
            progress_callback("uploading", 10, "正在上传DWG文件")
        file_id = self.upload_dwg(file_path, file_name)
        
        # 步骤3: 等待上传完成
        if progress_callback:
            progress_callback("uploading", 20, "等待上传完成")
        self.wait_for_upload_complete(file_id)
        
        # 步骤4: 发起转换
        if progress_callback:
            progress_callback("converting", 30, "正在发起图纸转换")
        self.start_conversion(file_id)
        
        # 步骤5: 等待转换完成
        if progress_callback:
            progress_callback("converting", 50, "等待转换完成")
        self.wait_for_conversion_complete(file_id)
        
        # 步骤6: 发起解析
        if progress_callback:
            progress_callback("analyzing", 60, "正在发起结构化解析")
        self.start_analysis(file_id)
        
        # 步骤7: 等待解析完成
        if progress_callback:
            progress_callback("analyzing", 80, "等待解析完成")
        self.wait_for_analysis_complete(file_id)
        
        # 步骤8: 获取结果
        if progress_callback:
            progress_callback("completed", 100, "获取解析结果")
        result = self.get_analysis_result(file_id)
        
        logger.info("图纸识别流程完成")
        return result


# 异步版本客户端
class AsyncGlodonIQcadClient(GlodonIQcadClient):
    """
    异步版本的广联达IQcad客户端
    """
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=ClientTimeout(total=self.timeout))
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_token_async(self) -> str:
        """异步获取令牌"""
        logger.info("正在异步获取广联达API访问令牌...")
        
        headers = {
            "Authorization": self._get_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        data = {
            "grant_type": "client_credentials"
        }
        
        try:
            async with self.session.post(
                self.TOKEN_URL,
                headers=headers,
                data=data
            ) as response:
                result = await response.json()
                
                if "access_token" not in result:
                    raise GlodonAuthError(f"获取令牌失败: {result}")
                
                self.access_token = result["access_token"]
                expires_in = result.get("expires_in", 7200)
                self.token_expire_time = time.time() + expires_in - 300
                
                return self.access_token
                
        except Exception as e:
            logger.error(f"异步获取令牌失败: {e}")
            raise GlodonAuthError(f"获取令牌失败: {e}")
    
    async def recognize_drawing_async(self, file_path: str,
                                      file_name: Optional[str] = None,
                                      progress_callback=None) -> Dict[str, Any]:
        """
        异步完整图纸识别流程
        
        Args:
            file_path: DWG文件路径
            file_name: 文件名
            progress_callback: 进度回调
            
        Returns:
            解析结果
        """
        logger.info("开始异步图纸识别流程...")
        
        if not self.session:
            self.session = aiohttp.ClientSession(timeout=ClientTimeout(total=self.timeout))
        
        # 这里实现完整的异步流程
        # 为简化，实际项目中需要将所有方法都改为异步
        # 此处使用同步方法包装为异步
        loop = asyncio.get_event_loop()
        
        result = await loop.run_in_executor(
            None,
            lambda: self.recognize_drawing(file_path, file_name, progress_callback)
        )
        
        return result
